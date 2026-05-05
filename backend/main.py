from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import math
import pandas as pd
import httpx
import re

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
    radius_m: int = 500

# ===== Load Station CSV =====
def load_stations_from_csv():
    file_path = r"/Users/apcy/Downloads/Route-EV/data/egat-data.csv"
    try:
        df = pd.read_csv(file_path, encoding="utf-8-sig")
        df.columns = df.columns.str.strip()
        return df.to_dict(orient="records")
    except Exception as e:
        print(f"Error loading CSV: {e}")
        return []

STATIONS_DATA = load_stations_from_csv()


# ===== Haversine Distance =====
def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

AMENITY_CACHE: dict = {}

# ===== Overpass API (OpenStreetMap) — ฟรี 100% =====
async def fetch_amenities(lat: float, lng: float, radius_m: int = 500):
    cache_key = f"{round(lat, 4)},{round(lng, 4)}_{radius_m}"
    if cache_key in AMENITY_CACHE:
        return AMENITY_CACHE[cache_key]

    amenities = {
        "toilets": False, "cafe": False, "restaurant": False, "mall": False,
        "hotel": False, "hospital": False, "bank": False, "pharmacy": False,
        "convenience": False, "fast_food": False,
    }

    # เพิ่ม Tag ให้ครอบคลุมการปักหมุดแปลกๆ ในไทย
    overpass_query = f"""
    [out:json][timeout:15];
    (
      node["amenity"~"^(toilets|cafe|restaurant|fast_food|bank|atm|pharmacy|hospital|clinic)$"](around:{radius_m},{lat},{lng});
      way["amenity"~"^(hospital|clinic)$"](around:{radius_m},{lat},{lng});
      node["shop"~"^(mall|supermarket|convenience|department_store|chemist)$"](around:{radius_m},{lat},{lng});
      way["shop"~"^(mall|supermarket|department_store)$"](around:{radius_m},{lat},{lng});
      node["tourism"="hotel"](around:{radius_m},{lat},{lng});
      way["tourism"="hotel"](around:{radius_m},{lat},{lng});
      node["amenity"="fuel"](around:{radius_m},{lat},{lng});
    );
    out tags;
    """

    AMENITY_MAP = {
        "toilets": "toilets", "cafe": "cafe", "restaurant": "restaurant",
        "fast_food": "fast_food", "bank": "bank", "atm": "bank",
        "pharmacy": "pharmacy", "chemist": "pharmacy", 
        "hospital": "hospital", "clinic": "hospital", 
        "hotel": "hotel", "fuel": "toilets",
    }
    SHOP_MAP = {
        "mall": "mall", "supermarket": "mall", "department_store": "mall", "convenience": "convenience",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post("https://overpass-api.de/api/interpreter", data={"data": overpass_query})
            if resp.status_code == 200:
                elements = resp.json().get("elements", [])
                for el in elements:
                    tags = el.get("tags", {})
                    if tags.get("amenity") in AMENITY_MAP: amenities[AMENITY_MAP[tags["amenity"]]] = True
                    if tags.get("shop") in SHOP_MAP: amenities[SHOP_MAP[tags["shop"]]] = True
                    if tags.get("tourism") == "hotel": amenities["hotel"] = True

                # ตรรกะเสริม
                if not amenities["toilets"] and amenities["mall"]:
                    amenities["toilets"] = True
    except Exception as e:
        print(f"Overpass Error: {e}")

    AMENITY_CACHE[cache_key] = amenities
    return amenities

@app.post("/api/find-stations")
async def find_nearby_stations(query: LocationQuery):
    nearby = []
    for s in STATIONS_DATA:
        try:
            lat_str, lng_str = str(s.get("Lattitude", "")).strip(), str(s.get("Longitude", "")).strip()
            if lat_str.lower() == 'nan' or lng_str.lower() == 'nan' or not lat_str or not lng_str: continue
            
            s_lat, s_lng = float(lat_str), float(lng_str)
            if s_lat == 0 or s_lng == 0: continue

            # คำนวณระยะทาง
            dist = haversine(query.lat, query.lng, s_lat, s_lng)

            if dist <= query.radius_km:
                
                # จัดการเวลา
                open_time = str(s.get("เวลาเปิด", "00:00")).strip()
                close_time = str(s.get("เวลาปิด", "23:59")).strip()
                if open_time.lower() == "nan" or close_time.lower() == "nan" or not open_time:
                    time_str = "เปิดบริการ 24 ชั่วโมง"
                else:
                    time_str = f"เปิดบริการ {open_time} - {close_time}"

                # จัดการหัวชาร์จ AC/DC
                dc_count = int(float(str(s.get("จำนวนหัวชาร์จ DC", 0)).replace('nan', '0') or 0))
                ac_count = int(float(str(s.get("จำนวนหัวชาร์จ AC", 0)).replace('nan', '0') or 0))

                if dc_count > 0 and ac_count > 0:
                    charge_type = "AC/DC"
                elif dc_count > 0:
                    charge_type = "DC"
                elif ac_count > 0:
                    charge_type = "AC"
                else:
                    charge_type = ""
                open_time, close_time = str(s.get("เวลาเปิด", "00:00")).strip(), str(s.get("เวลาปิด", "23:59")).strip()
                time_str = "เปิดบริการ 24 ชั่วโมง" if open_time.lower() == "nan" else f"เปิดบริการ {open_time} - {close_time}"

                dc_count = int(float(str(s.get("จำนวนหัวชาร์จ DC", 0)).replace('nan', '0') or 0))
                ac_count = int(float(str(s.get("จำนวนหัวชาร์จ AC", 0)).replace('nan', '0') or 0))
                charge_type = "AC/DC" if dc_count > 0 and ac_count > 0 else "DC" if dc_count > 0 else "AC" if ac_count > 0 else ""

                raw_power = str(s.get("พิกัดเครื่องชาร์จ", "0")).lower()
                power_match = re.search(r'(\d+)', raw_power)
                extracted_power = int(power_match.group(1)) if power_match else 0

                nearby.append({
                    "id": str(s.get("ชื่อสถานี", "N/A")), 
                    "name": str(s.get("ชื่อสถานี", "สถานีไม่มีชื่อ")),
                    "lat": s_lat, "lng": s_lng, "type": charge_type,
                    "connectors": "", 
                    "power_kw": extracted_power, 
                    "price": "7.5 บาท/หน่วย", 
                    "network": str(s.get("ชื่อโอเปอเรเตอร์", "EleX by EGAT")),
                    "time": time_str, "distance_km": round(dist, 2),
                    "amenities": {
                        "toilets": bool(s.get("has_toilets", False)),
                        "cafe": bool(s.get("has_cafe", False)),
                        "restaurant": bool(s.get("has_restaurant", False)),
                        "mall": bool(s.get("has_mall", False)),
                        "hotel": bool(s.get("has_hotel", False)),
                        "hospital": bool(s.get("has_hospital", False)),
                        "bank": bool(s.get("has_bank", False)),
                        "pharmacy": bool(s.get("has_pharmacy", False)),
                        "convenience": bool(s.get("has_convenience", False)),
                    }
                })
        except:
            continue

    nearby.sort(key=lambda x: x["distance_km"])
    print(f"✅ ผลลัพธ์: พบ {len(nearby)} สถานีในรัศมี {query.radius_km} กม.")
    return {"status": "success", "count": len(nearby), "data": nearby}

@app.post("/api/amenities")
async def get_amenities(query: AmenityQuery):
    return {"status": "success", "amenities": await fetch_amenities(query.lat, query.lng, query.radius_m)}

# ===== Endpoint: Calculate Route (OSRM ฟรี 100%) =====
@app.post("/api/route")
async def get_route(query: RouteQuery):
    url = f"https://router.project-osrm.org/route/v1/driving/{query.origin_lng},{query.origin_lat};{query.dest_lng},{query.dest_lat}?overview=full&geometries=geojson"
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            data = resp.json()

        if data.get("code") == "Ok":
            route = data["routes"][0]
            # แปลง GeoJSON [lng, lat] เป็น [lat, lng] สำหรับ Leaflet
            coordinates = [[p[1], p[0]] for p in route["geometry"]["coordinates"]]
            
            dist_km = round(route["distance"] / 1000, 2)
            dur_min = round(route["duration"] / 60, 1)
            return {
                "status": "success",
                "distance_km": dist_km,
                "distance_text": f"{dist_km} กม.",
                "duration_min": dur_min,
                "duration_text": f"{int(dur_min)} นาที",
                "coordinates": coordinates, # ส่งพิกัดไปวาดเส้นบนหน้าบ้าน
                "source": "osrm_free",
            }
    except Exception as e:
        print("OSRM fallback:", e)
        
    dist = haversine(query.origin_lat, query.origin_lng, query.dest_lat, query.dest_lng)
    return {
        "status": "success", "distance_km": round(dist, 2), "duration_min": round(dist * 2, 0),
        "distance_text": f"~{round(dist, 2)} กม.", "duration_text": f"~{round(dist * 2, 0)} นาที",
        "coordinates": [], "source": "haversine"
    }

@app.get("/")
def root():
    return {"message": "EleX API (FREE Version) is running 🚗⚡"}
