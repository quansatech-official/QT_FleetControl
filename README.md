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
