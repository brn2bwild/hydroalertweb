/* ============================================================
   HydroAlert — Dashboard logic
   ============================================================ */

// ---------- Configuración ----------
// Ajusta estos valores a tu instalación real.
const CONFIG = {
    API_URL: "/api/readings", // ruta de tu GET API (relativa, funciona en local y en Hostinger)
    REFRESH_MS: 2000, // cada cuánto se refresca el dashboard
    MAX_NIVEL_CM: 100, // nivel máximo que muestra la escala (tope de la última zona)
    DEVICE_LAT: 17.9869, // ubicación fija del dispositivo — cámbiala por la real
    DEVICE_LNG: -92.9303,
    CHART_MAX_POINTS: 20, // cuántos puntos recientes se muestran en la gráfica

    // Zonas de riesgo, de la más baja a la más alta.
    // "max" es el límite superior en cm de cada zona (acumulativo, no el ancho de la banda).
    ZONES: [
        { max: 40, label: "Normal", color: "#45c4b0" },
        { max: 70, label: "Precaución", color: "#f0a24c" },
        { max: 100, label: "Alerta de inundación", color: "#e0604f" },
    ],
};

let chart = null;
let map = null;
let marker = null;

// ---------- Arranque ----------
document.addEventListener("DOMContentLoaded", () => {
    initGauge();
    initChart();
    initMap();
    cargarDashboard();
    setInterval(cargarDashboard, CONFIG.REFRESH_MS);

    document.getElementById("alertDismiss")?.addEventListener("click", () => {
        document.getElementById("alertOverlay").classList.remove("visible");
    });
    document
        .getElementById("activarAudioBtn")
        ?.addEventListener("click", desbloquearAudio);
    document
        .getElementById("activarAudioWelcomeBtn")
        ?.addEventListener("click", () => {
            desbloquearAudio();
            cerrarBienvenida();
        });
    document
        .getElementById("omitirAudioBtn")
        ?.addEventListener("click", cerrarBienvenida);
});

let ultimaZonaAlertada = null;
let audioCtx = null;
function desbloquearAudio() {
    audioCtx =
        audioCtx || new (window.AudioContext || window.webkitAudioContext)();

    audioCtx.resume().then(() => {
        const boton = document.getElementById("activarAudioBtn");
        if (boton) {
            boton.classList.add("active");
            boton.title = "Alertas sonoras activas";
            boton.setAttribute("aria-label", "Alertas sonoras activas");
        }

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = 660;
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.12);
    });
}

function cerrarBienvenida() {
    document.getElementById("welcomeOverlay")?.classList.remove("visible");
}

function manejarAlertaCritica(zona, nivel) {
    const esZonaSegura = zona === CONFIG.ZONES[0];

    if (esZonaSegura) {
        // Al volver a Normal, "reseteamos" -- así la próxima vez que
        // suba de nuevo, sí vuelve a avisar.
        ultimaZonaAlertada = null;
        return;
    }

    if (zona.label === ultimaZonaAlertada) return; // ya avisamos de esta zona
    ultimaZonaAlertada = zona.label;

    mostrarModalAlerta(zona, nivel);
    reproducirAlarma();
}

function mostrarModalAlerta(zona, nivel) {
    const overlay = document.getElementById("alertOverlay");
    const modal = document.getElementById("alertModal");
    const iconRing = document.getElementById("alertIconRing");

    document.getElementById("alertModalTitle").textContent = zona.label;
    document.getElementById("alertModalText").textContent =
        `El nivel del río alcanzó ${nivel} cm.`;

    modal.style.borderColor = zona.color;
    iconRing.style.color = zona.color;
    iconRing.style.background = hexToRgba(zona.color, 0.15);

    overlay.classList.add("visible");
}

// Sirena de dos tonos generada con la Web Audio API -- no depende
// de ningún archivo de audio externo.
//
// Nota: los navegadores bloquean el audio hasta que el usuario haya
// interactuado con la página al menos una vez (clic, tecla, etc.).
// Es una protección estándar contra autoplay molesto, no un bug.
function reproducirAlarma() {
    try {
        audioCtx =
            audioCtx ||
            new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") {
            audioCtx.resume();
        }

        const ahora = audioCtx.currentTime;
        const ciclos = 3; // cuántas veces sube y baja el tono
        const duracionCiclo = 2.2; // segundos que dura cada "subida + bajada"
        const frecMin = 800; // Hz — tono más grave del barrido
        const frecMax = 1000; // Hz — tono más agudo del barrido

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = "sawtooth"; // más áspero y urgente que "square" o "sine"
        gain.gain.setValueAtTime(0.18, ahora);
        osc.connect(gain).connect(audioCtx.destination);

        for (let i = 0; i < ciclos; i++) {
            const inicioCiclo = ahora + i * duracionCiclo;
            osc.frequency.setValueAtTime(frecMin, inicioCiclo);
            osc.frequency.linearRampToValueAtTime(
                frecMax,
                inicioCiclo + duracionCiclo / 2,
            );
            osc.frequency.linearRampToValueAtTime(
                frecMin,
                inicioCiclo + duracionCiclo,
            );
        }

        osc.start(ahora);
        osc.stop(ahora + ciclos * duracionCiclo);
    } catch (error) {
        console.warn("No se pudo reproducir la alarma:", error);
    }
}

// ---------- Carga de datos ----------
async function cargarDashboard() {
    try {
        const respuesta = await fetch(CONFIG.API_URL);
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        const lecturas = await respuesta.json();

        if (lecturas.length === 0) return;

        setEstado(true);
        actualizarNivel(lecturas[0]);
        actualizarChart(lecturas);
        actualizarTabla(lecturas);
    } catch (error) {
        console.error("Error al cargar datos:", error);
        setEstado(false);
    }
}

// ---------- Estado de conexión ----------
function setEstado(enLinea) {
    const pill = document.getElementById("statusPill");
    const label = document.getElementById("statusLabel");
    pill.classList.toggle("offline", !enLinea);
    label.textContent = enLinea ? "En línea" : "Sin conexión";
}

// ---------- Escala hidrométrica (hero) ----------

// Construye las bandas de zona y las marcas de cm una sola vez, al cargar.
function initGauge() {
    const zonesContainer = document.getElementById("gaugeZones");
    const ticksContainer = document.getElementById("gaugeTicks");
    const legendContainer = document.getElementById("gaugeLegend");
    const max = CONFIG.MAX_NIVEL_CM;

    // Bandas: se agregan en orden normal porque el contenedor .gauge
    // usa flex-direction: column-reverse (así la primera zona queda abajo).
    let anterior = 0;
    CONFIG.ZONES.forEach((zone) => {
        const alturaPct = ((zone.max - anterior) / max) * 100;
        const banda = document.createElement("div");
        banda.className = "gauge-zone-band";
        banda.style.height = alturaPct + "%";
        banda.style.background = hexToRgba(zone.color, 0.08);
        zonesContainer.appendChild(banda);
        anterior = zone.max;
    });

    // Marcas de escala cada 20 cm (o cada 50 si el rango es grande).
    const paso = max > 200 ? 50 : 20;
    for (let v = 0; v <= max; v += paso) {
        const tick = document.createElement("div");
        tick.className = "gauge-tick";
        tick.style.bottom = (v / max) * 100 + "%";
        tick.textContent = v;
        ticksContainer.appendChild(tick);
    }

    // Leyenda de zonas
    CONFIG.ZONES.forEach((zone) => {
        const item = document.createElement("span");
        item.innerHTML = `<i style="background:${zone.color}"></i>${zone.label}`;
        legendContainer.appendChild(item);
    });
}

function zonaActual(nivel) {
    for (const zone of CONFIG.ZONES) {
        if (nivel <= zone.max) return zone;
    }
    return CONFIG.ZONES[CONFIG.ZONES.length - 1]; // por encima del máximo: zona de mayor riesgo
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function actualizarNivel(ultimaLectura) {
    const nivel = parseFloat(ultimaLectura.nivel);
    const porcentaje = Math.min(
        100,
        Math.max(0, (nivel / CONFIG.MAX_NIVEL_CM) * 100),
    );
    const zona = zonaActual(nivel);

    // Sube el agua en la escala, con el color de la zona de riesgo actual.
    const fill = document.getElementById("gaugeFill");
    fill.style.height = porcentaje + "%";
    fill.style.setProperty("--zone-color", zona.color);

    document.getElementById("nivelValor").innerHTML =
        `${nivel} <small>cm</small>`;

    const fecha = new Date(ultimaLectura.created_at);
    document.getElementById("ultimaActualizacion").innerHTML =
        `<strong>${ultimaLectura.device_id}</strong> · actualizado ${fecha.toLocaleTimeString()}`;

    // Indicador de riesgo en el header — lo primero que alguien debe ver.
    const riskPill = document.getElementById("riskPill");
    const riskDot = riskPill.querySelector(".status-dot");
    document.getElementById("riskLabel").textContent = zona.label;
    riskPill.style.borderColor = hexToRgba(zona.color, 0.5);
    riskDot.style.background = zona.color;
    riskDot.style.boxShadow = `0 0 8px ${zona.color}`;

    actualizarBanner(zona, nivel);
    manejarAlertaCritica(zona, nivel);
}
// El banner solo aparece en Precaución o Alerta — en Normal se oculta.
// CONFIG.ZONES[0] siempre es la zona "segura" más baja.
function actualizarBanner(zona, nivel) {
    const banner = document.getElementById("alertBanner");
    const dot = document.getElementById("alertDot");
    const texto = document.getElementById("alertText");

    const esZonaSegura = zona === CONFIG.ZONES[0];

    if (esZonaSegura) {
        banner.classList.remove("visible");
        return;
    }

    banner.classList.add("visible");
    banner.style.borderColor = hexToRgba(zona.color, 0.5);
    banner.style.background = hexToRgba(zona.color, 0.1);
    banner.style.color = zona.color;
    dot.style.background = zona.color;
    texto.innerHTML = `<strong>${zona.label}</strong> — nivel actual ${nivel} cm`;
}

// ---------- Gráfica en tiempo real ----------
function initChart() {
    const ctx = document.getElementById("nivelChart").getContext("2d");
    chart = new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Nivel (cm)",
                    data: [],
                    borderColor: "#45c4b0",
                    backgroundColor: "rgba(69, 196, 176, 0.12)",
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.3,
                    fill: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { color: "#16293a" },
                    ticks: { color: "#7691a0", maxTicksLimit: 6 },
                },
                y: {
                    grid: { color: "#16293a" },
                    ticks: { color: "#7691a0" },
                    beginAtZero: true,
                },
            },
        },
    });
}

function actualizarChart(lecturas) {
    // Tomamos las últimas N lecturas y las invertimos para que el tiempo avance de izq. a der.
    const recientes = lecturas.slice(0, CONFIG.CHART_MAX_POINTS).reverse();

    chart.data.labels = recientes.map((l) =>
        new Date(l.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        }),
    );
    chart.data.datasets[0].data = recientes.map((l) => parseFloat(l.nivel));
    chart.update();
}

// ---------- Mapa de ubicación ----------
function initMap() {
    map = L.map("map", {
        zoomControl: true,
        attributionControl: true,
    }).setView([CONFIG.DEVICE_LAT, CONFIG.DEVICE_LNG], 15);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    marker = L.marker([CONFIG.DEVICE_LAT, CONFIG.DEVICE_LNG])
        .addTo(map)
        .bindPopup("Sensor HydroAlert");
}

// ---------- Tabla de historial ----------
function actualizarTabla(lecturas) {
    const tbody = document.getElementById("tablaHistorial");
    tbody.innerHTML = "";

    lecturas.slice(0, 15).forEach((lectura) => {
        const fila = document.createElement("tr");
        const fecha = new Date(lectura.created_at).toLocaleString();
        fila.innerHTML = `
      <td class="device-tag">${lectura.device_id}</td>
      <td>${lectura.nivel} cm</td>
      <td>${fecha}</td>
    `;
        tbody.appendChild(fila);
    });
}
