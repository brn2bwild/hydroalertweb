# 🌊 HydroAlert

**Sistema de monitoreo y alerta temprana de nivel de río**, orientado a la detección de inundaciones.

Un sensor ultrasónico mide el nivel del agua y transmite la lectura por radio **LoRa** hasta un receptor **ESP32**, que la envía por **HTTPS** a una API construida en **Laravel**. Los datos se almacenan en **MariaDB** y se visualizan en un dashboard web en tiempo real, con alertas visuales y sonoras cuando el nivel entra en zona de riesgo.

Proyecto académico desarrollado como parte de un curso de sistemas embebidos / desarrollo web.

---

## Tabla de contenido

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Stack tecnológico](#stack-tecnológico)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Requisitos previos](#requisitos-previos)
- [Instalación](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [API](#api)
- [Dashboard web](#dashboard-web)
- [Firmware del ESP32](#firmware-del-esp32)
- [Despliegue en producción](#despliegue-en-producción)
- [Buenas prácticas del proyecto](#buenas-prácticas-del-proyecto)
- [Solución de problemas](#solución-de-problemas)
- [Contribuir](#contribuir)
- [Roadmap](#roadmap)
- [Autores](#autores)
- [Licencia](#licencia)

---

## Características

- 📡 Transmisión de datos por radio LoRa, de largo alcance y bajo consumo, entre el sensor y el receptor.
- 🔒 Envío de datos al backend por HTTPS, con soporte automático para entornos de prueba (HTTP) y producción (HTTPS).
- 📊 Dashboard en tiempo real con escala hidrométrica visual, gráfica de tendencia, mapa de ubicación y bitácora de lecturas.
- 🚨 Sistema de zonas de riesgo configurable (Normal / Precaución / Alerta de inundación), con alertas visuales y sonoras.
- ⚙️ Modo de configuración en campo: un botón físico en el ESP32 activa un punto de acceso WiFi con una página de calibración, sin necesidad de reprogramar el dispositivo.
- 🌐 Despliegue en hosting compartido, sin requerir un VPS dedicado.

---

## Arquitectura

```
┌──────────────────┐     LoRa      ┌──────────────────┐     HTTPS     ┌───────────────────┐
│  Sensor           │ ───────────▶ │  ESP32 receptor  │ ────────────▶ │  API (Laravel)     │
│  ultrasónico       │   915 MHz    │  LoRa + WiFi      │  POST/JSON    │  + MariaDB         │
└──────────────────┘               └──────────────────┘               └─────────┬──────────┘
                                                                                   │
                                                                        ┌──────────┴──────────┐
                                                                        ▼                     ▼
                                                              ┌──────────────────┐  ┌──────────────────┐
                                                              │  Dashboard web    │  │  API de consulta  │
                                                              │  (tiempo real)    │  │  (GET /readings)  │
                                                              └──────────────────┘  └──────────────────┘
```

El nivel de agua se calcula como la diferencia entre una altura de referencia y la distancia medida por el sensor:

```
nivel_agua = altura_de_referencia − distancia_medida
```

---

## Stack tecnológico

| Capa                | Tecnología                                                               |
| ------------------- | ------------------------------------------------------------------------ |
| Sensor / transmisor | Sensor ultrasónico + módulo LoRa (SX1276)                                |
| Receptor            | ESP32, librería RadioLib, pantalla OLED SSD1306                          |
| Backend             | Laravel 13 (PHP 8.3)                                                     |
| Base de datos       | MariaDB                                                                  |
| Frontend            | HTML, CSS y JavaScript (sin dependencias de build), Chart.js, Leaflet.js |
| Hosting             | Hostinger (hosting compartido)                                           |

---

## Estructura del proyecto

```
├── app/
│   ├── Http/Controllers/ReadingController.php   # Lógica de la API (crear y consultar lecturas)
│   └── Models/
│       └── Reading.php
├── database/migrations/
│   └── ..._create_readings_table.php
├── resources/views/dashboard/
│   └── index.blade.php                          # Vista del dashboard
├── public/assets/dashboard/
│   ├── css/dashboard.css
│   ├── js/dashboard.js
│   └── img/                                      # Logo del proyecto
├── routes/
│   ├── web.php                                   # Ruta raíz → dashboard
│   └── api.php                                   # Rutas de la API
└── firmware/
    └── LoRaReceptor.ino                          # Firmware del ESP32 receptor
```

---

## Requisitos previos

- PHP 8.3 o superior
- Composer
- MariaDB o MySQL
- Node.js y npm (opcional — solo necesario si se compilan assets adicionales con Vite)
- Arduino IDE o PlatformIO, con soporte para ESP32

---

## Instalación

```bash
git clone <https://github.com/SixtoMV31/hydroalertweb.git>
cd hydroalert

composer install
cp .env.example .env
php artisan key:generate
```

Configura la base de datos en `.env` (ver siguiente sección) y ejecuta las migraciones:

```bash
php artisan migrate
```

Levanta el servidor de desarrollo:

```bash
php artisan serve --host=0.0.0.0
```

> El parámetro `--host=0.0.0.0` permite que otros dispositivos de la red local (como el ESP32) puedan conectarse al servidor, no solo la máquina donde corre.

---

## Variables de entorno

El archivo `.env` no se incluye en el repositorio, ya que contiene credenciales. Se genera a partir de `.env.example`:

```env
APP_ENV=local
APP_DEBUG=true
APP_KEY=

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=hydroalert
DB_USERNAME=root
DB_PASSWORD=
```

En producción:

```env
APP_ENV=production
APP_DEBUG=false
```

---

## API

### `POST /api/readings`

Registra una nueva lectura. Utilizado por el firmware del ESP32.

**Solicitud:**

```json
{
    "device_id": "HYDRO-001",
    "nivel": 45.5
}
```

**Respuesta `201 Created`:**

```json
{
    "message": "Reading created successfully",
    "reading": {
        "id": 1,
        "device_id": "HYDRO-001",
        "nivel": "45.50",
        "created_at": "2026-09-01T10:30:00.000000Z",
        "updated_at": "2026-09-01T10:30:00.000000Z"
    }
}
```

| Campo       | Tipo     | Requerido |
| ----------- | -------- | --------- |
| `device_id` | string   | Sí        |
| `nivel`     | numérico | Sí        |

### `GET /api/readings`

Devuelve las últimas 100 lecturas registradas, ordenadas de la más reciente a la más antigua. Utilizado por el dashboard.

```json
[
    {
        "id": 2,
        "device_id": "HYDRO-001",
        "nivel": "24.00",
        "created_at": "..."
    },
    { "id": 1, "device_id": "HYDRO-001", "nivel": "25.50", "created_at": "..." }
]
```

---

## Dashboard web

Disponible en la ruta raíz (`/`). Su configuración está centralizada en `public/assets/dashboard/js/dashboard.js`:

```js
const CONFIG = {
    API_URL: "/api/readings",
    REFRESH_MS: 5000, // frecuencia de actualización automática
    MAX_NIVEL_CM: 100, // valor máximo de la escala
    DEVICE_LAT: 17.9869, // ubicación del dispositivo en el mapa
    DEVICE_LNG: -92.9303,
    CHART_MAX_POINTS: 20, // puntos mostrados en la gráfica

    ZONES: [
        { max: 40, label: "Normal", color: "#45c4b0" },
        { max: 70, label: "Precaución", color: "#f0a24c" },
        { max: 100, label: "Alerta de inundación", color: "#e0604f" },
    ],
};
```

**Componentes:**

- Escala hidrométrica con zonas de riesgo configurables.
- Gráfica de nivel en tiempo real (Chart.js).
- Mapa de ubicación del dispositivo (Leaflet + OpenStreetMap).
- Historial de lecturas recientes.
- Alertas visuales (banner y modal) y sonoras cuando el nivel entra en zona de riesgo.

El logo del proyecto se coloca en `public/assets/dashboard/img/` y se referencia desde `index.blade.php`.

---

## Firmware del ESP32

Archivo: `firmware/LoRaReceptor.ino`

### Configuración requerida antes de subirlo

```cpp
const char* RED = "nombre_de_tu_red";
const char* PASSWORD = "tu_password";
String SERVER = "https://tudominio.com";   // sin puerto ni '/' al final
const String DEVICE_ID = "HYDRO-001";
```

### Modos de operación

Al encender, el dispositivo revisa el estado del botón **BOOT (GPIO 0)**:

| Estado del botón | Modo          | Comportamiento                                                                               |
| ---------------- | ------------- | -------------------------------------------------------------------------------------------- |
| Presionado       | Configuración | Crea un punto de acceso WiFi con una página para calibrar la altura de referencia del sensor |
| Sin presionar    | Operación     | Se conecta a la red WiFi configurada y comienza a transmitir lecturas                        |

### Seguridad de la conexión

El firmware valida automáticamente si el servidor usa HTTP o HTTPS y ajusta la conexión en consecuencia. Actualmente omite la validación del certificado SSL (`setInsecure()`); se recomienda migrar a `setCACert()` con el certificado de producción antes de un despliegue definitivo.

---

## Despliegue en producción

1. Configurar el **Document Root** del dominio para que apunte a la carpeta `public/` del proyecto.
2. Activar el certificado SSL (Let's Encrypt) desde el panel de hosting.
3. Si se compilan assets con Vite, ejecutar `npm run build` una sola vez — nunca `npm run dev` en el servidor.
4. Si las rutas están en caché, aplicar los cambios con `php artisan route:clear && php artisan route:cache`.

---

## Buenas prácticas del proyecto

- Ejecutar `composer install` (y `npm install`, si aplica) después de cada `git pull` — `vendor/` y `node_modules/` no se versionan.
- Instalar las dependencias de Node directamente en el servidor de destino, nunca copiando `node_modules/` entre sistemas operativos distintos.
- Usar `npm run build` para producción; `npm run dev` es exclusivamente para desarrollo local.
- Mantener todas las credenciales en `.env`, nunca en el código fuente.
- Usar la IP local real (no `127.0.0.1`) al configurar el ESP32 para pruebas en red local.

---

## Solución de problemas

| Síntoma                                                           | Causa                                                             | Solución                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Failed to open stream: vendor/autoload.php`                      | Falta la carpeta `vendor/`                                        | `composer install`                                                  |
| `MissingAppKeyException`                                          | Falta `APP_KEY` en `.env`                                         | `php artisan key:generate`                                          |
| Laravel pide confirmación al migrar (`APPLICATION IN PRODUCTION`) | `APP_ENV=production` en un entorno local                          | Cambiar a `APP_ENV=local`                                           |
| `could not find driver` al migrar                                 | `DB_CONNECTION` apunta a un driver incorrecto                     | Configurar `DB_CONNECTION=mysql` y los demás datos de conexión      |
| El dominio muestra la página por defecto del hosting              | El Document Root no apunta a `public/`                            | Corregir la ruta raíz del dominio en el panel de hosting            |
| `Connection refused` al probar la API                             | El servidor no está corriendo, o se usa una IP/puerto incorrectos | Verificar `php artisan serve --host=0.0.0.0` y la IP local correcta |

---

## Contribuir

```bash
git pull
composer install
# revisar .env.example por variables nuevas
php artisan migrate
```

Al integrar cambios de otros colaboradores, regenerar siempre `vendor/` (y `node_modules/`, si aplica) de forma local — estas carpetas no forman parte del repositorio.

---

## Roadmap

- [ ] Migrar la validación del certificado SSL del ESP32 de `setInsecure()` a `setCACert()`.
- [ ] Incorporar notificaciones por Telegram para alertas críticas.
- [ ] Soporte para múltiples dispositivos, con ubicación configurable por dispositivo en base de datos.
- [ ] Notificaciones push del navegador como complemento a las alertas sonoras.

---

## Autores

- _Sixto Mendez_ — desarrollo backend, frontend y dashboard
- _Daniel Perez Flores_ —Asesor y colaborador del proyecto
- _Evelin Arleth_ -Encargados de documentar
- _Jose Alejandro_ -Encargados de documentar


_Proyecto desarrollado con fines de investigacion._

---

## Licencia

Este proyecto se distribuye con fines académicos.
