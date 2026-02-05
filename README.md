# QT FleetControl

**QT FleetControl** is an independent **fleet analytics dashboard** for company vehicles, designed to transform raw vehicle telematics data into **clear, business-relevant insights**.

It uses **Traccar purely as a telemetry backend** (OBD / GPS data ingestion) and provides a **separate, modern frontend and API** for analysis, reporting, and monitoring.

> Traccar collects the data.  
> **QT FleetControl makes it usable for operations, controlling, and audits.**

---

## 🚗 Use Case

QT FleetControl is built for:

- Company-owned vehicles (no private usage)
- Operational fleets (service, technicians, logistics, construction)
- Businesses that need **proof of vehicle usage**
- Environments where **Traccar UI is not exposed to end users**

Typical questions it answers:

- How many hours was a vehicle actively in use per day/month?
- Are vehicles under- or over-utilized?
- What is the current fuel level?
- Did fuel suddenly drop (theft, leak, anomaly)?
- Can I generate a clean monthly PDF report for audits or management?

---

## 🧱 Architecture

QT FleetControl is intentionally **decoupled from Traccar**.

Traccar Stack
├─ Traccar Server (Java)
└─ Traccar MySQL Database (read-only access)

QT FleetControl Stack
├─ API (Node.js / Express)
└─ Frontend (React, static)


- Traccar remains untouched
- QT FleetControl **reads data read-only** from the Traccar database
- Both stacks can be updated independently
- No Traccar UI exposure to customers

---

## ✨ Features

### Activity Analytics
- Active driving time per day (monthly view)
- Noise suppression (traffic lights, stop-and-go)
- Configurable thresholds
- Bar chart visualization

### Fuel Monitoring
- Current fuel level
- Fuel history (monthly)
- Fuel drop detection (sudden or gradual)
- Sensor-key configurable (OBD dependent)

### Alerts
- Fuel drop alerts with timestamp and delta
- Designed for theft / leak detection
- Read-only analytics (no device control)

### Reports
- Monthly **PDF activity report**
- Audit-friendly layout
- Server-side PDF generation
- No client-side rendering tricks

---

## 🧪 Technology Stack

**Backend**
- Node.js (ESM)
- Express
- MySQL (`mysql2`)
- Puppeteer (PDF generation)

**Frontend**
- React
- Vite
- Recharts
- Plain CSS (no UI framework)

**Infrastructure**
- Docker
- Docker Compose
- No reverse proxy required

---

## 🔐 Data & Security Model

- QT FleetControl uses a **read-only database user**
- No writes to Traccar database
- No schema changes
- No device control
- Designed to be audit-safe

---

## ⚙️ Configuration

All configuration is done via environment variables.

Example `.env`:

```env
DB_HOST=traccar-db
DB_PORT=3306
DB_NAME=traccar
DB_USER=qt_readonly
DB_PASS=changeme

FUEL_JSON_KEY=fuel

MIN_SPEED_KMH=5
STOP_TOLERANCE_SEC=120
MIN_MOVING_SECONDS=60

FUEL_DROP_LITERS=10
FUEL_DROP_PERCENT=8
FUEL_WINDOW_MINUTES=10

PORT=3000
VITE_API_BASE=http://localhost:3000/api

JWT_SECRET=change_me
JWT_EXPIRES_IN=12h
TRACCAR_BASE_URL=http://traccar:8082
TRACCAR_AUTH_MODE=api
AUTH_DISABLED=true
VITE_AUTH_DISABLED=true
```

### Environment Variables (Detailed)

**Database / Traccar**
- `DB_HOST`: Traccar MySQL host.
- `DB_PORT`: Traccar MySQL port.
- `DB_NAME`: Traccar database name.
- `DB_USER`: Read-only DB user.
- `DB_PASS`: Read-only DB password.

**Auth**
- `JWT_SECRET`: Secret for JWT signing.
- `JWT_EXPIRES_IN`: Token lifetime (e.g., `12h`).
- `TRACCAR_BASE_URL`: Traccar base URL (required for API auth mode).
- `TRACCAR_AUTH_MODE`: `api` or `db`.
- `AUTH_DISABLED`: `true` to disable backend auth (dev only).
- `VITE_AUTH_DISABLED`: `true` to disable frontend auth (dev only).

**Frontend**
- `PORT`: Backend port.
- `VITE_API_BASE`: Backend API base URL for the frontend.

**Activity / Driving Logic**
- `MIN_SPEED_KMH`: Speed threshold to consider moving.
- `STOP_TOLERANCE_SEC`: Short dips below threshold tolerated.
- `MIN_MOVING_SECONDS`: Minimum duration for a movement block.
- `MIN_STOP_SECONDS`: Gap/idle duration that ends a block.
- `DASHBOARD_STOP_TOLERANCE_SEC`: Dashboard-specific tolerance for brief stops.
- `DASHBOARD_MIN_MOVING_SECONDS`: Dashboard-specific minimum block length.
- `DASHBOARD_MIN_STOP_SECONDS`: Dashboard-specific stop duration.
- `DETAIL_GAP_SECONDS`: Detail report: merge gaps shorter than this.
- `DETAIL_STOP_SECONDS`: Detail report: stop threshold for blocks.
- `DETAIL_MIN_SEGMENT_SECONDS`: Detail report: drop segments shorter than this.
- `DETAIL_MIN_SEGMENT_DISTANCE_M`: Detail report: consecutive trips shorter than this distance are merged (default `1000`).
- `DETAIL_MIN_START_END_DISTANCE_M`: Detail report: drop segments with too-small start/end distance.
- `DETAIL_MERGE_STOP_SECONDS`: Detail report: merge short gaps if same/nearby locations.
- `DIST_MAX_SPEED_KMH`: Max speed cap for distance calculation (ignore GPS jumps).

**Fuel**
- `FUEL_JSON_KEY`: Comma-separated list of fuel keys (e.g., `fuel,io48`).
- `FUEL_DROP_LITERS`: Absolute drop threshold.
- `FUEL_DROP_PERCENT`: Percent drop threshold.
- `FUEL_WINDOW_MINUTES`: Window for detecting drops.
- `FUEL_REFUEL_LITERS`: Absolute refill threshold.
- `FUEL_REFUEL_PERCENT`: Percent refill threshold.

**Geocoding (PDF)**
- `PDF_GEOCODE`: `true` to reverse-geocode addresses in PDF.
- `GEOCODE_PROVIDER`: Optional provider switch. Supported: `mapsco` or empty (default Nominatim).
- `GEOCODE_URL`: Override reverse-geocode endpoint URL.
- `GEOCODE_API_KEY`: API key for provider (if required).
- `GEOCODE_API_KEY_PARAM`: Query param name for API key (e.g., `api_key`).
- `GEOCODE_FORMAT`: `format` query param value (e.g., `json` or `jsonv2`).
- `GEOCODE_EXTRA_PARAMS`: Extra query params (URL-encoded, e.g., `zoom=18&addressdetails=1`).
- `GEOCODE_CONCURRENCY`: Max concurrent reverse-geocode requests.

## 🗺️ Self-hosted Nominatim (AT)

This repo includes an optional Nominatim service (Austria extract) in `docker-compose.yml`.
It will download and import the Austria PBF on first start and then apply daily updates.

**Enable in `.env`:**
```env
PDF_GEOCODE=true
GEOCODE_URL=http://nominatim:8080/reverse
GEOCODE_CONCURRENCY=2
```

**Start services:**
```bash
docker compose up -d nominatim qt-api qt-frontend
```

Notes:
- First import can take a long time depending on your hardware.
- The Nominatim HTTP port is mapped to `8085` on the host.
