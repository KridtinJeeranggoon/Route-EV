# ⚡ Route-EV (EV Trip Planner)

A full-stack EV trip planning application developed for EGAT, designed to help users locate EV charging stations and nearby facilities using real-time location-based services.

<img src="/images/home-screen.png" width="500" alt="Screenshot 2026-05-12 162249">
<img width="1918" height="967" alt="Screenshot 2026-05-12 162249" src="https://github.com/user-attachments/assets/5247902e-80f5-4f0a-800e-1fe1913e4e88" />

---

## 🚀 Features

- 📍 EV route planning and charging station discovery  
- 🔎 Nearby facility search (restaurants, cafes, etc.)  
- 🗺 Integration with map and location-based APIs  
- ⚡ Real-time data fetching and dynamic search  
- 🌐 Full-stack web application (Frontend + Backend)  

---

## 🏗️ System Architecture

The system is composed of:

- **Frontend (Next.js)**: Handles UI and user interaction  
- **Backend API**: Processes requests and communicates with external services  
- **External APIs**: Google Maps / Places API for location data  

---

## 🛠️ Tech Stack

- **Frontend**: Next.js  
- **Backend**: (e.g., Node.js / Python API)  
- **APIs**: Google Maps Platform (Places API, Geolocation)  
- **Deployment**: (e.g., Vercel / Cloud)  

---

## 💻⚙️ Installation

```bash
git clone https://github.com/KridtinJeeranggoon/Route-EV.git
cd Route-EV

---

## 🖥️ Frontend

```bash
npm install
cd frontend
npm run dev

---

## ⚙️ Backend

```bash
pip install -r requirements.txt
cd backend
uvicorn main:app --reload

---

## 🔑 Environment Variables
Create a .env file
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_api_key
