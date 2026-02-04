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
