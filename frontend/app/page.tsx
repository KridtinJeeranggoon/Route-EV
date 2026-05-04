"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./MapView"), { 
  ssr: false, 
  loading: () => <div style={{width:'100%', height:'100%', display:'flex', justifyContent:'center', alignItems:'center', background:'#e9ecef', color: '#888'}}>กำลังโหลดแผนที่...</div> 
});

const FALLBACK_LOCATION = { lat: 14.015, lng: 100.725 };
const API_BASE = "http://localhost:8000";

interface Station { id: string; name: string; lat: number; lng: number; type: string; address: string; connectors: string; power_kw: number; network: string; time: string; distance_km: number; amenities?: any; }
interface RouteInfo { distance_km: number; distance_text?: string; duration_min: number; duration_text?: string; coordinates?: [number, number][]; }

// 🔌 นำรายการโลโก้หัวชาร์จกลับมาแล้วครับ!
const CONNECTOR_LOGOS: Record<string, string> = {
  "Type 2": "/image/charge-head-type2.png", "CCS2": "/image/charge-head-CCS2.png", "CHAdeMO": "/image/charge-head-chademo.png",
  "Three Phase": "/image/charge-head-three-phase.png", "Type 1": "/image/charge-head-type1.png", "GB/T-DC": "/image/charge-head-GB-T-DC.png",
  "GB/T-AC": "/image/charge-head-GB-T-AC.png", "Tesla": "/image/charge-head-tesla.png", "Wall": "/image/charge-head-wall.png",
};

const YELLOW = "#ffd500"; const DARK = "#1a1a1a"; const BORDER = "#e8e8e8";

export default function EleXApp() {
  const [currentLocation, setCurrentLocation] = useState(FALLBACK_LOCATION);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("สถานีชาร์จ");
  const [searchQuery, setSearchQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState(10);
  const [powerFilters, setPowerFilters] = useState<number[]>([]);
  const [displayPower, setDisplayPower] = useState(0);
  const [amenityFilters, setAmenityFilters] = useState<string[]>([]); 
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>(["Type 2", "CCS2"]); // State สำหรับหัวชาร์จ
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  
  const [mapCenter, setMapCenter] = useState(FALLBACK_LOCATION);
  const [mapZoom, setMapZoom] = useState(11);

  const fetchStations = useCallback(async (loc: { lat: number; lng: number }, radius?: number) => {
    setLoading(true);
    const r = radius ?? radiusKm;
    try {
      const res = await fetch(`${API_BASE}/api/find-stations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: loc.lat, lng: loc.lng, radius_km: r }),
      });
      const json = await res.json();
      setStations(json.data || []); 
      setSelectedStation(null); 
      setRouteInfo(null);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [radiusKm]);

  const calculateRoute = useCallback(async (station: Station) => {
    setRouteLoading(true); setRouteInfo(null);
    try {
      const res = await fetch(`${API_BASE}/api/route`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin_lat: currentLocation.lat, origin_lng: currentLocation.lng, dest_lat: station.lat, dest_lng: station.lng }),
      });
      const json = await res.json();
      if (json.status === "success") setRouteInfo(json);
    } catch (e) { console.error(e); } finally { setRouteLoading(false); }
  }, [currentLocation]);

  const handleSelectStation = useCallback((station: Station) => {
    setSelectedStation(station); 
    calculateRoute(station);
    setMapCenter({ lat: station.lat, lng: station.lng });
  }, [calculateRoute]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; setCurrentLocation(loc); setMapCenter(loc); fetchStations(loc, radiusKm); },
        () => fetchStations(FALLBACK_LOCATION, radiusKm), { enableHighAccuracy: true, timeout: 6000 }
      );
    } else { fetchStations(FALLBACK_LOCATION, radiusKm); }
  }, []);

  const handleRadiusChange = (r: number) => {
    setRadiusKm(r); fetchStations(currentLocation, r);
    setMapCenter(currentLocation); setMapZoom(r <= 5 ? 13 : r <= 10 ? 11 : 10);
  };

  const toggleConnector = (type: string) => setSelectedConnectors((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);
  const toggleAmenityFilter = (key: string) => setAmenityFilters((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  const togglePowerFilter = (power: number) => setPowerFilters((prev) => prev.includes(power) ? prev.filter((p) => p !== power) : [...prev, power]);
  const clearRoute = () => { setRouteInfo(null); setSelectedStation(null); setMapCenter(currentLocation); setMapZoom(radiusKm <= 5 ? 13 : radiusKm <= 10 ? 11 : 10); };

  const filteredStations = stations.filter((s) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q) || s.network.toLowerCase().includes(q) || s.connectors.toLowerCase().includes(q);
    const stationPower = s.power_kw || 0;
    let matchPower = true;
    if (powerFilters.length > 0) {
      matchPower = powerFilters.includes(stationPower);
    }
    
    let matchAmenity = true;
    if (amenityFilters.length > 0 && s.amenities) {
      matchAmenity = amenityFilters.every((key) => s.amenities[key] === true);
    }

    return matchSearch && matchPower && matchAmenity;
  });

  return (
    <div style={{ backgroundColor: "#f4f5f7", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Sans Thai', 'Sarabun', sans-serif" }}>
      <div style={{ width: "100%", maxWidth: "1500px", height: "92vh", backgroundColor: "white", borderRadius: "16px", boxShadow: "0 8px 48px rgba(0,0,0,0.12)", display: "flex", overflow: "hidden", margin: "20px" }}>
        
        {/* LEFT SIDEBAR */}
        <div style={{ width: "420px", minWidth: "420px", display: "flex", flexDirection: "column", borderRight: `1px solid ${BORDER}`, backgroundColor: "#fff", zIndex: 10 }}>
          <div style={{ padding: "20px 24px 0 24px", borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <img src="/image/logo-EleX-by-EGAT.png" alt="EleX Logo" style={{ height: "65px", objectFit: "contain" }} onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
                <div style={{ fontSize: "12px", color: "#555", fontWeight: 600 }}>{loading ? "กำลังโหลด..." : `${filteredStations.length} สถานี`}</div>
              </div>
              <select value={radiusKm} onChange={(e) => handleRadiusChange(Number(e.target.value))} style={{ fontSize: "12px", color: "#666", background: "#f8f8f8", padding: "6px 12px", borderRadius: "20px", border: `1px solid ${BORDER}`, outline: "none", cursor: "pointer" }}>
                <option value={5}>รัศมี 5 กม.</option><option value={10}>รัศมี 10 กม.</option><option value={15}>รัศมี 15 กม.</option><option value={50}>รัศมี 50 กม.</option><option value={100}>รัศมี 100 กม.</option><option value={9999}>สถานีทั้งหมด</option>
              </select>
            </div>
            <div style={{ position: "relative", marginBottom: "16px" }}>
              <input type="text" placeholder="ค้นหาชื่อ, ที่อยู่, เครือข่าย..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: "100%", padding: "11px 40px 11px 16px", borderRadius: "25px", border: `1.5px solid ${searchQuery ? YELLOW : BORDER}`, outline: "none", fontSize: "13px", boxSizing: "border-box", backgroundColor: "#fafafa", color: "#000", transition: "border 0.2s" }} onFocus={(e) => e.target.style.borderColor = YELLOW} onBlur={(e) => e.target.style.borderColor = searchQuery ? YELLOW : BORDER} />
              {searchQuery && <span onClick={() => setSearchQuery("")} style={{ position: "absolute", right: "14px", top: "11px", color: "#aaa", cursor: "pointer", fontSize: "16px" }}>✕</span>}
            </div>
            
            {/* นำแท็บ "หัวจ่าย" กลับมาแล้ว */}
            <div style={{ display: "flex", gap: "2px" }}>
              {["สถานีชาร์จ", "กำลังไฟ", "หัวจ่าย", "สิ่งอำนวยฯ", "เครือข่าย"].map((tab) => (
                <div key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, textAlign: "center", padding: "10px 0", fontSize: "12px", cursor: "pointer", color: activeTab === tab ? DARK : "#999", fontWeight: activeTab === tab ? 700 : 400, borderBottom: activeTab === tab ? `3px solid ${YELLOW}` : "3px solid transparent", transition: "0.2s", whiteSpace: "nowrap" }}>{tab}</div>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, minHeight: "80px", maxHeight: activeTab === "สิ่งอำนวยฯ" || activeTab === "หัวจ่าย" ? "240px" : "150px", overflowY: "auto" }}>
            {activeTab === "สถานีชาร์จ" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {[{ label: "เปิดให้บริการ", active: true }, { label: "ไม่มีเครื่องว่าง", active: true }, { label: "ปิดบริการ", active: true }, { label: "ส่วนบุคคล", active: false }].map((item) => (
                  <button key={item.label} style={{ padding: "9px 12px", backgroundColor: item.active ? YELLOW : "#fff", border: item.active ? `1px solid ${YELLOW}` : `1px solid ${BORDER}`, borderRadius: "25px", fontSize: "12px", fontWeight: item.active ? 700 : 400, cursor: "pointer", color: item.active ? DARK : "#888" }}>{item.label}</button>
                ))}
              </div>
            )}
            
            {activeTab === "กำลังไฟ" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ fontSize: "11px", color: "#888", fontWeight: 600 }}>กรองสถานีตามกำลังไฟตู้ชาร์จ</div>
                  {powerFilters.length > 0 && <button onClick={() => setPowerFilters([])} style={{ padding: "4px 8px", borderRadius: "15px", border: "1px solid #ffcdd2", backgroundColor: "#ffebee", fontSize: "10px", color: "#d32f2f", cursor: "pointer", fontWeight: 600 }}>✕ ล้าง ({powerFilters.length})</button>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px" }}>
                  {[ 
                    { kw: 22, label: "22 kW (AC)" }, 
                    { kw: 50, label: "50 kW (DC)" }, 
                    { kw: 90, label: "90 kW (DC)" }, 
                    { kw: 120, label: "120 kW (DC)" }, 
                    { kw: 125, label: "125 kW (DC)" }, 
                    { kw: 150, label: "150 kW (DC)" }
                  ].map(({ kw, label }) => {
                    const active = powerFilters.includes(kw);
                    return (
                      <button 
                        key={kw} 
                        onClick={() => togglePowerFilter(kw)} 
                        style={{ padding: "7px 10px", borderRadius: "20px", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", backgroundColor: active ? YELLOW : "#fff", border: `1.5px solid ${active ? "#ffd500" : BORDER}`, fontWeight: active ? 700 : 400, color: active ? DARK : "#666", transition: "0.15s" }}
                      >
                        <span> {label}</span>
                        {active && <span style={{ fontSize: "10px" }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* เพิ่มหน้าต่างสำหรับเลือกหัวชาร์จ */}
            {activeTab === "หัวจ่าย" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {Object.keys(CONNECTOR_LOGOS).map((type) => {
                  const active = selectedConnectors.includes(type);
                  return (
                    <button key={type} onClick={() => toggleConnector(type)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "10px", border: `1.5px solid ${active ? YELLOW : BORDER}`, backgroundColor: active ? "#fffbea" : "#fff", cursor: "pointer", transition: "0.15s" }}>
                      <img src={CONNECTOR_LOGOS[type]} alt={type} style={{ width: "24px", height: "24px", objectFit: "contain" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      <span style={{ fontSize: "12px", fontWeight: active ? 700 : 400, color: active ? DARK : "#666" }}>{type}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === "สิ่งอำนวยฯ" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ fontSize: "11px", color: "#888", fontWeight: 600 }}>กรองสถานีตามสิ่งอำนวยความสะดวก</div>
                  {amenityFilters.length > 0 && <button onClick={() => setAmenityFilters([])} style={{ padding: "4px 8px", borderRadius: "15px", border: "1px solid #ffcdd2", backgroundColor: "#ffebee", fontSize: "10px", color: "#d32f2f", cursor: "pointer", fontWeight: 600 }}>✕ ล้าง ({amenityFilters.length})</button>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "7px" }}>
                  {[ { key: "toilets", icon: "/image/icn-toilet.png", emoji: "🚻", label: "ห้องน้ำ" }, { key: "cafe", icon: "/image/icn-coffee.png", emoji: "☕", label: "ร้านกาแฟ" }, { key: "restaurant", icon: "/image/icn-food.png", emoji: "🍜", label: "ร้านอาหาร" }, { key: "mall", icon: "/image/icn-mall.png", emoji: "🏬", label: "ห้าง" }, { key: "hotel", icon: "/image/icn-hotel.jpeg", emoji: "🏨", label: "โรงแรม" }, { key: "hospital", icon: "/image/icn-hospital.jpg", emoji: "🏥", label: "โรงพยาบาล" }, { key: "bank", icon: "/image/icn-bank.jpg", emoji: "🏦", label: "ธนาคาร" }, { key: "pharmacy", icon: "/image/icn-pharmacy.webp", emoji: "💊", label: "ร้านยา" }, { key: "convenience", icon: "/image/icn-convenience.jpg", emoji: "🏪", label: "มินิมาร์ท" } ].map(({ key, icon, emoji, label }) => {
                    const active = amenityFilters.includes(key);
                    return (
                      <button key={key} onClick={() => toggleAmenityFilter(key)} style={{ padding: "7px 10px", borderRadius: "20px", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "7px", backgroundColor: active ? YELLOW : "#fff", border: `1.5px solid ${active ? "#ffd500" : BORDER}`, fontWeight: active ? 700 : 400, color: active ? DARK : "#666", transition: "0.15s" }}>
                        <img src={icon} alt={label} style={{ width: "16px", height: "16px", objectFit: "contain" }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).insertAdjacentText("afterend", emoji); }} />{label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            
            {activeTab === "เครือข่าย" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {[ { name: "EleX by EGAT", count: "60 สถานี" }, { name: "BackEN EV", count: "40 สถานี" }, { name: "PEA VOLTA", count: "30 สถานี" } ].map((net) => (
                  <div key={net.name} style={{ padding: "12px 10px", backgroundColor: "#f0f0f0", borderRadius: "10px", cursor: "default", border: `1px solid #d8d8d8` }}><div style={{ fontWeight: 700, fontSize: "13px", color: "#666" }}>{net.name}</div></div>
                ))}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {loading ? <div style={{ padding: "40px", textAlign: "center", color: "#aaa" }}>กำลังโหลดข้อมูลสถานี...</div> : filteredStations.length === 0 ? <div style={{ padding: "40px", textAlign: "center", color: "#aaa" }}>ไม่พบสถานีในเงื่อนไขที่คุณเลือก</div> : (
              filteredStations.map((s) => (
                <StationCard key={s.id} station={s} isSelected={selectedStation?.id === s.id} onSelect={() => handleSelectStation(s)} routeInfo={selectedStation?.id === s.id ? routeInfo : null} routeLoading={selectedStation?.id === s.id ? routeLoading : false} onClearRoute={clearRoute} />
              ))
            )}
          </div>
        </div>

        {/* RIGHT MAP */}
        <div style={{ flex: 1, position: "relative" }}>
          <MapView center={mapCenter} zoom={mapZoom} currentLocation={currentLocation} stations={filteredStations} selectedStation={selectedStation} radiusKm={radiusKm} routeCoordinates={routeInfo?.coordinates} onSelectStation={handleSelectStation} />
          
          {routeInfo && selectedStation && (
            <div style={{ position: "absolute", bottom: "24px", left: "50%", transform: "translateX(-50%)", backgroundColor: "white", borderRadius: "16px", padding: "16px 24px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", display: "flex", alignItems: "center", gap: "24px", minWidth: "360px", border: `2px solid ${YELLOW}`, zIndex: 1000 }}>
              <div>
                <div style={{ fontSize: "11px", color: "#888", marginBottom: "2px" }}>ไปยัง: {selectedStation.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "20px", marginTop: "4px" }}>
                  <div><div style={{ fontSize: "22px", fontWeight: 900, color: DARK }}>{routeInfo.distance_text || `${routeInfo.distance_km} กม.`}</div><div style={{ fontSize: "11px", color: "#888" }}>ระยะทาง</div></div>
                  <div style={{ width: "1px", height: "36px", backgroundColor: BORDER }} />
                  <div><div style={{ fontSize: "22px", fontWeight: 900, color: DARK }}>{routeInfo.duration_text || `${Math.round(routeInfo.duration_min)} นาที`}</div><div style={{ fontSize: "11px", color: "#888" }}>เวลาเดินทาง</div></div>
                </div>
              </div>
              <button onClick={clearRoute} style={{ marginLeft: "auto", padding: "8px 16px", backgroundColor: "#f0f0f0", border: "none", borderRadius: "20px", cursor: "pointer", fontSize: "12px", color: "#555", fontWeight: 600 }}>✕ ล้างเส้นทาง</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StationCard({ station, isSelected, onSelect, routeInfo, routeLoading, onClearRoute }: { station: Station; isSelected: boolean; onSelect: () => void; routeInfo: RouteInfo | null; routeLoading: boolean; onClearRoute: () => void; }) {
  return (
    <div onClick={onSelect} style={{ padding: "18px 20px", borderBottom: `1px solid ${BORDER}`, backgroundColor: isSelected ? "#fffbea" : "white", cursor: "pointer", transition: "background-color 0.15s", borderLeft: isSelected ? `4px solid ${YELLOW}` : "4px solid transparent" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
        <div style={{ flex: 1, paddingRight: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: DARK, lineHeight: "1.3" }}>{station.name}</h3>
          {station.power_kw > 0 && (
            <div style={{ fontSize: "12px", color: "#666", marginTop: "4px", fontWeight: 600 }}>
              {station.power_kw} kW
            </div>
          )}
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#888", lineHeight: "1.4" }}>{station.address}</p>
        </div>
        <div style={{ textAlign: "center", minWidth: "60px" }}>
          <div style={{ width: "38px", height: "38px", borderRadius: "50%", border: isSelected ? `2px solid ${YELLOW}` : `1.5px solid #ddd`, display: "flex", alignItems: "center", justifyContent: "center", marginLeft: "auto", backgroundColor: isSelected ? YELLOW : "white" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isSelected ? DARK : "#888"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg></div>
          <div style={{ fontSize: "10px", color: "#888", marginTop: "3px" }}>{routeLoading ? "..." : `${station.distance_km} กม.`}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: isSelected ? "10px" : "0" }}><span style={{ fontSize: "11px", color: "#00a651", fontWeight: 600 }}>{station.time}</span>{station.type && (<span style={{ fontSize: "10px", backgroundColor: station.type.includes("DC") ? "#fff3cd" : "#d4edda", color: station.type.includes("DC") ? "#856404" : "#155724", padding: "2px 7px", borderRadius: "10px", fontWeight: 600 }}>{station.type}</span>)}</div>
      
      {isSelected && (
        <div style={{ marginTop: "10px", padding: "12px", backgroundColor: "white", borderRadius: "10px", border: `1px solid ${BORDER}` }}>
          {routeLoading ? <div style={{ fontSize: "12px", color: "#aaa", textAlign: "center", padding: "8px" }}>กำลังคำนวณเส้นทาง...</div> : routeInfo ? (
            <div style={{ display: "flex", gap: "16px", marginBottom: "12px", padding: "10px 0", borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ textAlign: "center", flex: 1 }}><div style={{ fontSize: "18px", fontWeight: 900, color: DARK }}>{routeInfo.distance_text || `${routeInfo.distance_km} กม.`}</div><div style={{ fontSize: "10px", color: "#999" }}>ระยะทาง</div></div><div style={{ width: "1px", backgroundColor: BORDER }} />
              <div style={{ textAlign: "center", flex: 1 }}><div style={{ fontSize: "18px", fontWeight: 900, color: DARK }}>{routeInfo.duration_text || `${Math.round(routeInfo.duration_min)} น.`}</div><div style={{ fontSize: "10px", color: "#999" }}>เวลาเดินทาง</div></div>
            </div>
          ) : null}
          <div style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#555", marginBottom: "8px" }}>สิ่งอำนวยความสะดวกรอบข้าง</div>
            {station.amenities && (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <AmenityBadge icon="/image/icn-toilet.png" label="ห้องน้ำ" available={station.amenities.toilets} />
                <AmenityBadge icon="/image/icn-coffee.png" label="ร้านกาแฟ" available={station.amenities.cafe} />
                <AmenityBadge icon="/image/icn-food.png" label="ร้านอาหาร" available={station.amenities.restaurant} />
                <AmenityBadge icon="/image/icn-mall.png" label="ห้าง" available={station.amenities.mall} />
                <AmenityBadge icon="/image/icn-hotel.jpeg" label="โรงแรม" available={station.amenities.hotel} />
                <AmenityBadge icon="/image/icn-hospital.jpg" label="โรงพยาบาล" available={station.amenities.hospital} />
                <AmenityBadge icon="/image/icn-bank.jpg" label="ธนาคาร" available={station.amenities.bank} />
                <AmenityBadge icon="/image/icn-pharmacy.webp" label="ร้านยา" available={station.amenities.pharmacy} />
                <AmenityBadge icon="/image/icn-convenience.jpg" label="มินิมาร์ท" available={station.amenities.convenience} />
              </div>
            )}
          </div>
          <button onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}&travelmode=driving`, "_blank"); }} style={{ width: "100%", padding: "10px", backgroundColor: YELLOW, border: "none", borderRadius: "25px", fontWeight: 700, fontSize: "13px", cursor: "pointer", color: DARK, marginBottom: "6px" }}>นำทางใน Google Maps</button>
          <button onClick={(e) => { e.stopPropagation(); onClearRoute(); }} style={{ width: "100%", padding: "8px", backgroundColor: "transparent", border: `1px solid ${BORDER}`, borderRadius: "25px", fontSize: "12px", cursor: "pointer", color: "#888" }}>✕ ปิดรายละเอียด</button>
        </div>
      )}
    </div>
  );
}

function AmenityBadge({ icon, label, available }: { icon: string; label: string; available: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 9px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, backgroundColor: available ? "#e8f5e9" : "#f5f5f5", color: available ? "#2e7d32" : "#bbb", border: `1px solid ${available ? "#c8e6c9" : "#e0e0e0"}` }}>
      {icon.includes("/") ? <img src={icon} alt={label} style={{ width: "14px", height: "14px", objectFit: "contain", opacity: available ? 1 : 0.5 }} /> : <span>{icon}</span>}
      <span>{label}</span>{available ? <span style={{ color: "#43a047" }}>✓</span> : <span style={{ color: "#ccc" }}>✗</span>}
    </div>
  );
}