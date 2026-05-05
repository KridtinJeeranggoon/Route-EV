from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import math
import pandas as pd
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

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
    # 🔧 แก้ path ให้ตรงกับไฟล์ CSV ของคุณ
    file_path = "/Users/apcy/Downloads/Route-EV/data/egat-data.csv"
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
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ===== Overpass API: Expanded Amenity Finder =====
async def fetch_amenities(lat: float, lng: float, radius_m: int = 500):
    """
    ดึงข้อมูล amenity จาก Google Places API (Nearby Search)
    ใช้ API Key เดียวกับ Google Maps
    """
    api_key = os.getenv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "")
    
    # กำหนดค่าเริ่มต้นเป็น False ทั้งหมด
    amenities = {
        "toilets": False,
        "cafe": False,
        "restaurant": False,
        "mall": False,
        "hotel": False,
        "hospital": False,
        "bank": False,
        "pharmacy": False,
        "convenience": False,
    }

    if not api_key:
        print("⚠️ ไม่พบ GOOGLE_MAPS_API_KEY ข้ามการค้นหาสิ่งอำนวยความสะดวก")
        return amenities

    url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    
    # ใน Google Places API เราค้นหาหลายประเภทพร้อมกันตรงๆ ไม่ได้ ต้องค้นหาทีละกลุ่ม
    # หรือใช้ keyword ค้นหากว้างๆ แล้วมากรองจาก 'types' ที่ Google ส่งกลับมา
    params = {
        "location": f"{lat},{lng}",
        "radius": radius_m,
        "key": api_key,
        "language": "th",
        # ใช้ประเภทกว้างๆ หรือจะไม่ระบุก็ได้ แต่เพื่อประหยัดจำนวนผลลัพธ์ ลองดึงเฉพาะที่เกี่ยวกับร้านค้า/บริการ
        "type": "point_of_interest" 
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            data = resp.json()

            if data.get("status") == "OK":
                results = data.get("results", [])
                
                # วนลูปดูผลลัพธ์ที่ Google หาเจอในรัศมี
                for place in results:
                    types = place.get("types", [])
                    
                    # เช็คประเภทสถานที่ (types) ที่ Google จับคู่ให้
                    if "cafe" in types:
                        amenities["cafe"] = True
                    if "restaurant" in types or "food" in types:
                        amenities["restaurant"] = True
                    if "shopping_mall" in types:
                        amenities["mall"] = True
                    if "lodging" in types: # Google ใช้คำว่า lodging แทน hotel
                        amenities["hotel"] = True
                    if "hospital" in types:
                        amenities["hospital"] = True
                    if "bank" in types or "atm" in types:
                        amenities["bank"] = True
                    if "pharmacy" in types:
                        amenities["pharmacy"] = True
                    if "convenience_store" in types:
                        amenities["convenience"] = True
                    
                    # หมายเหตุ: Google Places ไม่มี type ที่เจาะจงว่า "ห้องน้ำสาธารณะ (toilets)" โดยตรง 
                    # ยกเว้นจะเป็นจุดพักรถใหญ่ๆ เราจึงอาจต้องใช้ลอจิกช่วยบ้างในส่วนของห้องน้ำ
                    
            else:
                 print(f"Google Places API error: {data.get('status')} - {data.get('error_message', '')}")

    except Exception as e:
        print(f"Request to Google Places API failed: {e}")

    return amenities


# ===== Endpoint: Find Nearby Stations =====
@app.post("/api/find-stations")
async def find_nearby_stations(query: LocationQuery):
    nearby = []
    print(f"\nเริ่มค้นหาพิกัด: {query.lat}, {query.lng} | รัศมี {query.radius_km} กม. ---")
    print(f"จำนวนสถานีในระบบทั้งหมด: {len(STATIONS_DATA)} สถานี")
    
    if len(STATIONS_DATA) > 0:
        print("รายชื่อคอลัมน์ที่อ่านได้จริง:", list(STATIONS_DATA[0].keys()))

    for s in STATIONS_DATA:
        try:
            # ดึงค่าดิบมาก่อน
            lat_raw = s.get("Lattitude", 0)
            lng_raw = s.get("Longitude", 0)

            # แปลงเป็นสตริงเพื่อจัดการกับช่องว่างและค่า NaN ของ Pandas
            lat_str = str(lat_raw).strip()
            lng_str = str(lng_raw).strip()

            # ถ้าใน CSV ช่องว่างเปล่า มันจะกลายเป็นคำว่า 'nan' ให้ข้ามไปเลย
            if lat_str.lower() == 'nan' or lng_str.lower() == 'nan' or lat_str == '' or lng_str == '':
                continue

            s_lat = float(lat_str)
            s_lng = float(lng_str)

            if s_lat == 0 or s_lng == 0:
                continue

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

                nearby.append({
                    "id": str(s.get("ชื่อสถานี", "N/A")), 
                    "name": str(s.get("ชื่อสถานี", "สถานีไม่มีชื่อ")),
                    "lat": s_lat,
                    "lng": s_lng,
                    "type": charge_type,
                    "address": str(s.get("พิกัดเครื่องชาร์จ", "ไม่ระบุ")),
                    "connectors": "",
                    "power_kw": 0,
                    "network": str(s.get("ชื่อโอเปอเรเตอร์", "EleX by EGAT")),
                    "time": time_str,
                    "distance_km": round(dist, 2),
                })
        except Exception as e:
            # ปริ้นบอกเลยว่า Error แถวไหน จะได้รู้ว่า CSV มีตัวหนังสือแปลกๆ ปนตรงไหนไหม
            print(f"ข้ามสถานี {s.get('ชื่อสถานี', 'Unknown')} เนื่องจาก Error: {e}")
            continue

    nearby.sort(key=lambda x: x["distance_km"])
    print(f"✅ ผลลัพธ์: พบ {len(nearby)} สถานีในรัศมี {query.radius_km} กม.")
    return {"status": "success", "count": len(nearby), "data": nearby}


# ===== Endpoint: Get Amenities Near Station =====
@app.post("/api/amenities")
async def get_amenities(query: AmenityQuery):
    amenities = await fetch_amenities(query.lat, query.lng, query.radius_m)
    return {"status": "success", "amenities": amenities}


# ===== Endpoint: Calculate Route Distance (Google Maps Directions) =====
@app.post("/api/route")
async def get_route(query: RouteQuery):
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
    if not api_key:
        dist = haversine(query.origin_lat, query.origin_lng, query.dest_lat, query.dest_lng)
        return {
            "status": "success",
            "distance_km": round(dist, 2),
            "duration_min": round(dist * 2, 0),
            "source": "haversine",
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
                "source": "google_maps",
            }
        else:
            return {"status": "error", "message": data["status"]}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ===== Health Check =====
@app.get("/")
def root():
    return {
        "message": "EleX EV Station API is running 🚗⚡",
        "stations_loaded": len(STATIONS_DATA),
    }
