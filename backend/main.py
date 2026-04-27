from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import math
import pandas as pd
import httpx
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== Models =====
class LocationQuery(BaseModel):
    lat: float
    lng: float
    radius_km: float = 10.0

class RouteQuery(BaseModel):
    origin_lat: float
    origin_lng: float
    dest_lat: float
    dest_lng: float

class AmenityQuery(BaseModel):
    lat: float
    lng: float
    radius_m: int = 500  # รัศมีค้นหา amenity รอบสถานีชาร์จ (เมตร)

# ===== Load Station CSV =====
def load_stations_from_csv():
    # 🔧 แก้ path ให้ตรงกับไฟล์ CSV ของคุณ
    file_path = r"C:\Users\pinkp\OneDrive\Desktop\my_project\WebApp_noey\data\station.csv"
    try:
        df = pd.read_csv(file_path, encoding="utf-8-sig")
        df.columns = df.columns.str.strip()
        print(f"✅ โหลดข้อมูล CSV สำเร็จ: {len(df)} สถานี | คอลัมน์: {list(df.columns)}")
        return df.to_dict(orient="records")
    except Exception as e:
        print(f"❌ Error loading CSV: {e}")
        return []

STATIONS_DATA = load_stations_from_csv()

# ===== Haversine Distance =====
def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

# ===== Overpass API: Amenity Finder =====
async def fetch_amenities(lat: float, lng: float, radius_m: int = 500):
    """
    ดึงข้อมูล amenity จาก OpenStreetMap (Overpass API) รอบพิกัดที่กำหนด
    ค้นหา: ห้องน้ำ (toilets), ร้านกาแฟ (cafe), ห้างสรรพสินค้า (mall/supermarket/convenience)
    """
    query = f"""
    [out:json][timeout:10];
    (
      node["amenity"="toilets"](around:{radius_m},{lat},{lng});
      node["amenity"="cafe"](around:{radius_m},{lat},{lng});
      node["amenity"="restaurant"](around:{radius_m},{lat},{lng});
      node["shop"="mall"](around:{radius_m},{lat},{lng});
      node["shop"="supermarket"](around:{radius_m},{lat},{lng});
      node["shop"="convenience"](around:{radius_m},{lat},{lng});
    );
    out body;
    """
    overpass_url = "https://overpass-api.de/api/interpreter"

    amenities = {
        "toilets": False,
        "cafe": False,
        "restaurant": False,
        "mall": False,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(overpass_url, data={"data": query})
            if resp.status_code == 200:
                elements = resp.json().get("elements", [])
                for el in elements:
                    tags = el.get("tags", {})
                    amenity = tags.get("amenity", "")
                    shop = tags.get("shop", "")

                    if amenity == "toilets":
                        amenities["toilets"] = True
                    if amenity in ("cafe",):
                        amenities["cafe"] = True
                    if amenity in ("restaurant", "fast_food"):
                        amenities["restaurant"] = True
                    if shop in ("mall", "supermarket", "convenience"):
                        amenities["mall"] = True
    except Exception as e:
        print(f"⚠️ Overpass API error: {e}")

    return amenities

# ===== Endpoint: Find Nearby Stations =====
@app.post("/api/find-stations")
async def find_nearby_stations(query: LocationQuery):
    nearby = []

    for s in STATIONS_DATA:
        try:
            s_lat = float(s.get("latitude", 0) or 0)
            s_lng = float(s.get("longitude", 0) or 0)
            if s_lat == 0 or s_lng == 0:
                continue

            dist = haversine(query.lat, query.lng, s_lat, s_lng)
            if dist <= query.radius_km:
                nearby.append({
                    "id": str(s.get("station_id_operator", "N/A")),
                    "name": str(s.get("station_name", "สถานีไม่มีชื่อ")),
                    "lat": s_lat,
                    "lng": s_lng,
                    "type": str(s.get("ac_dc_Mix", "N/A")),
                    "address": str(s.get("province", "ไม่ระบุ")),
                    "connectors": str(s.get("connector_type", "")),
                    "power_kw": s.get("max_power_kw", 0),
                    "network": str(s.get("network", "EleX by EGAT")),
                    "time": "เปิดบริการ จ - อา 00:00-23:59",
                    "distance_km": round(dist, 2),
                })
        except (ValueError, TypeError):
            continue

    nearby.sort(key=lambda x: x["distance_km"])
    return {"status": "success", "count": len(nearby), "data": nearby}

# ===== Endpoint: Get Amenities Near Station =====
@app.post("/api/amenities")
async def get_amenities(query: AmenityQuery):
    amenities = await fetch_amenities(query.lat, query.lng, query.radius_m)
    return {"status": "success", "amenities": amenities}

# ===== Endpoint: Calculate Route Distance (Google Maps Directions) =====
@app.post("/api/route")
async def get_route(query: RouteQuery):
    """
    คำนวณระยะทางและเวลาจากจุดเริ่มต้นไปยังสถานีชาร์จ
    ใช้ Google Maps Directions API
    """
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    if not api_key:
        # Fallback: คืนค่า haversine ถ้าไม่มี API key
        dist = haversine(query.origin_lat, query.origin_lng, query.dest_lat, query.dest_lng)
        return {
            "status": "success",
            "distance_km": round(dist, 2),
            "duration_min": round(dist * 2, 0),  # ประมาณ 30 km/h
            "source": "haversine"
        }

    url = "https://maps.googleapis.com/maps/api/directions/json"
    params = {
        "origin": f"{query.origin_lat},{query.origin_lng}",
        "destination": f"{query.dest_lat},{query.dest_lng}",
        "mode": "driving",
        "key": api_key,
        "language": "th",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            data = resp.json()

        if data["status"] == "OK":
            leg = data["routes"][0]["legs"][0]
            return {
                "status": "success",
                "distance_km": round(leg["distance"]["value"] / 1000, 2),
                "distance_text": leg["distance"]["text"],
                "duration_min": round(leg["duration"]["value"] / 60, 1),
                "duration_text": leg["duration"]["text"],
                "source": "google_maps"
            }
        else:
            return {"status": "error", "message": data["status"]}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ===== Health Check =====
@app.get("/")
def root():
    return {"message": "EleX EV Station API is running 🚗⚡", "stations_loaded": len(STATIONS_DATA)}
