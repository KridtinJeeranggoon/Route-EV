"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Circle,
  DirectionsRenderer,
  Libraries,
} from "@react-google-maps/api";

// ===== CONFIG =====
const FALLBACK_LOCATION = { lat: 14.015, lng: 100.725 };
const API_BASE = "http://localhost:8000";
const LIBRARIES: Libraries = ["places"];

// ===== TYPES =====
interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: string;
  address: string;
  connectors: string;
  power_kw: number;
  network: string;
  time: string;
  distance_km: number;
  amenities?: {
    toilets: boolean;
    cafe: boolean;
    restaurant: boolean;
    mall: boolean;
    fast_food: boolean;
    hotel: boolean;
    hospital: boolean;
    bank: boolean;
    pharmacy: boolean;
    convenience: boolean;
  };
}

interface RouteInfo {
  distance_km: number;
  distance_text?: string;
  duration_min: number;
  duration_text?: string;
}

// ===== CONNECTOR LOGOS (เปลี่ยนจาก Emojis เป็นไฟล์ภาพ) =====
const CONNECTOR_LOGOS: Record<string, string> = {
  "Type 2": "/image/charge-head-type2.png",
  "CCS2": "/image/charge-head-CCS2.png",
  "CHAdeMO": "/image/charge-head-chademo.png",
  "Three Phase": "/image/charge-head-three-phase.png",
  "Type 1": "/image/charge-head-type1.png",
  "GB/T-DC": "/image/charge-head-GB-T-DC.png",
  "GB/T-AC": "/image/charge-head-GB-T-AC.png",
  "Tesla": "/image/charge-head-tesla.png",
  "Wall": "/image/charge-head-wall.png",
};

const RADIUS_OPTIONS = [5, 10, 15, 50, 100];

const YELLOW = "#FFD600";
const DARK = "#1a1a1a";
const BORDER = "#e8e8e8";

// ===== MAIN COMPONENT =====
export default function EleXApp() {
  const [currentLocation, setCurrentLocation] = useState(FALLBACK_LOCATION);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("สถานีชาร์จ");
  const [searchQuery, setSearchQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState(10);
  const [powerFilter, setPowerFilter] = useState(200);
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>(["Type 2", "CCS2"]);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [amenityLoading, setAmenityLoading] = useState(false);
  const [mapRef, setMapRef] = useState<google.maps.Map | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: LIBRARIES,
  });

  // ===== Fetch Stations =====
  const fetchStations = useCallback(
    async (loc: { lat: number; lng: number }, radius?: number) => {
      setLoading(true);
      const r = radius ?? radiusKm;
      try {
        const res = await fetch(`${API_BASE}/api/find-stations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: loc.lat, lng: loc.lng, radius_km: r }),
        });
        const json = await res.json();
        setStations(json.data || []);
        setSelectedStation(null);
        setDirections(null);
        setRouteInfo(null);
      } catch (e) {
        console.error("fetchStations error:", e);
      } finally {
        setLoading(false);
      }
    },
    [radiusKm]
  );

  // ===== Fetch Amenities for a station =====
  const fetchAmenities = useCallback(async (station: Station) => {
    setAmenityLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/amenities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: station.lat, lng: station.lng, radius_m: 500 }),
      });
      const json = await res.json();
      
      // 1. รับค่าความแม่นยำ 100% จาก Google Places API ที่ส่งมาจาก Backend
      const apiAmenities = json.amenities || {
        toilets: false, cafe: false, restaurant: false, mall: false,
        hotel: false, hospital: false, bank: false,
        pharmacy: false, convenience: false,
      };

      // 2. ช่วย Google หาห้องน้ำ เพราะ Google ไม่ค่อยมีหมุดห้องน้ำสาธารณะ
      const name = station.name.toLowerCase();
    
      // ถ้าชื่อสถานที่คือ ปั๊มน้ำมัน หรือ ห้างสรรพสินค้า บังคับให้ห้องน้ำ เป็น True ไปเลย
      if (
        name.includes("pt ") || name.includes("pt-") || name.includes("พีที") ||
        name.includes("ปั๊ม") || name.includes("สถานีบริการ") ||
        name.includes("เซ็นทรัล") || name.includes("central") || 
        name.includes("โลตัส") || name.includes("lotus") || 
        name.includes("โรบินสัน") || name.includes("robinson") ||
        name.includes("บิ๊กซี") || name.includes("big c")
      ) {
        apiAmenities.toilets = true;
      }

      return apiAmenities;
    } catch (e) {
      console.error("fetchAmenities error:", e);
      return null;
    } finally {
      setAmenityLoading(false);
    }
  }, []);

  // ===== Calculate Route =====
  const calculateRoute = useCallback(
    async (station: Station) => {
      if (!isLoaded) return;
      setRouteLoading(true);
      setDirections(null);
      setRouteInfo(null);

      try {
        const directionsService = new google.maps.DirectionsService();
        const result = await directionsService.route({
          origin: new google.maps.LatLng(currentLocation.lat, currentLocation.lng),
          destination: new google.maps.LatLng(station.lat, station.lng),
          travelMode: google.maps.TravelMode.DRIVING,
        });
        setDirections(result);
        const leg = result.routes[0].legs[0];
        setRouteInfo({
          distance_km: leg.distance!.value / 1000,
          distance_text: leg.distance!.text,
          duration_min: leg.duration!.value / 60,
          duration_text: leg.duration!.text,
        });
      } catch {
        try {
          const res = await fetch(`${API_BASE}/api/route`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              origin_lat: currentLocation.lat,
              origin_lng: currentLocation.lng,
              dest_lat: station.lat,
              dest_lng: station.lng,
            }),
          });
          const json = await res.json();
          setRouteInfo(json);
        } catch (e2) {
          console.error("route fallback error:", e2);
        }
      } finally {
        setRouteLoading(false);
      }
    },
    [currentLocation, isLoaded]
  );

  // ===== Select Station =====
  const handleSelectStation = useCallback(
    async (station: Station) => {
      setSelectedStation(station);
      calculateRoute(station);

      if (mapRef) {
        mapRef.panTo({ lat: station.lat, lng: station.lng });
        mapRef.setZoom(15);
      }

      if (!station.amenities) {
        const amenities = await fetchAmenities(station);
        setStations((prev) =>
          prev.map((s) => (s.id === station.id ? { ...s, amenities } : s))
        );
        setSelectedStation((prev) =>
          prev?.id === station.id ? { ...prev, amenities } : prev
        );
      }
    },
    [calculateRoute, fetchAmenities, mapRef]
  );

  // ===== GPS on mount =====
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCurrentLocation(loc);
          fetchStations(loc, radiusKm);
        },
        () => fetchStations(FALLBACK_LOCATION, radiusKm),
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else {
      fetchStations(FALLBACK_LOCATION, radiusKm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Radius change handler =====
  const handleRadiusChange = (r: number) => {
    setRadiusKm(r);
    fetchStations(currentLocation, r);
    if (mapRef) {
      mapRef.panTo(currentLocation);
      mapRef.setZoom(r <= 5 ? 13 : r <= 10 ? 11 : 10);
    }
  };

  const toggleConnector = (type: string) =>
    setSelectedConnectors((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );

  const clearRoute = () => {
    setDirections(null);
    setRouteInfo(null);
    setSelectedStation(null);
    if (mapRef) {
      mapRef.panTo(currentLocation);
      mapRef.setZoom(radiusKm <= 5 ? 13 : radiusKm <= 10 ? 11 : 10);
    }
  };

  // ===== Filter stations by search (name + address + network) =====
  const filteredStations = stations.filter((s) => {
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.address.toLowerCase().includes(q) ||
      s.network.toLowerCase().includes(q) ||
      s.connectors.toLowerCase().includes(q)
    );
  });

  return (
    <div
      style={{
        backgroundColor: "#f4f5f7",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Noto Sans Thai', 'Sarabun', sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "1500px",
          height: "92vh",
          backgroundColor: "white",
          borderRadius: "16px",
          boxShadow: "0 8px 48px rgba(0,0,0,0.12)",
          display: "flex",
          overflow: "hidden",
          margin: "20px",
        }}
      >
        {/* ===== LEFT SIDEBAR ===== */}
        <div
          style={{
            width: "420px",
            minWidth: "420px",
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${BORDER}`,
            backgroundColor: "#fff",
          }}
        >
          {/* HEADER */}
          <div
            style={{
              padding: "20px 24px 0 24px",
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            {/* Logo and Radius Selector */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "16px",
              }}
            >
              {/* โลโก้ซ้ายบน */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <img src="/image/logo-EleX-by-EGAT.png" alt="EleX Logo" style={{ height: "36px", objectFit: "contain" }} />
                <div style={{ fontSize: "12px", color: "#555", fontWeight: 600 }}>
                  {loading ? "กำลังค้นหา..." : `${stations.length} สถานี`}
                </div>
              </div>

              {/* Dropdown เลือกรัศมีขวาบน */}
              <select
                value={radiusKm}
                onChange={(e) => handleRadiusChange(Number(e.target.value))}
                style={{
                  fontSize: "12px",
                  color: "#666",
                  background: "#f8f8f8",
                  padding: "6px 12px",
                  borderRadius: "20px",
                  border: `1px solid ${BORDER}`,
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value={5}>รัศมี 5 กม.</option>
                <option value={10}>รัศมี 10 กม.</option>
                <option value={15}>รัศมี 15 กม.</option>
                <option value={50}>รัศมี 50 กม.</option>
                <option value={100}>รัศมี 100 กม.</option>
              </select>
            </div>

            {/* Search bar */}
            <div style={{ position: "relative", marginBottom: "16px" }}>
              <input
                type="text"
                placeholder="ค้นหาชื่อ, ที่อยู่, เครือข่าย, หัวจ่าย..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "11px 40px 11px 16px",
                  borderRadius: "25px",
                  border: `1.5px solid ${BORDER}`,
                  outline: "none",
                  fontSize: "13px",
                  boxSizing: "border-box",
                  backgroundColor: "#fafafa",
                  transition: "border 0.2s",
                }}
                onFocus={(e) => (e.target.style.borderColor = YELLOW)}
                onBlur={(e) => (e.target.style.borderColor = BORDER)}
              />
              {searchQuery ? (
                <span
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: "14px",
                    top: "11px",
                    color: "#aaa",
                    cursor: "pointer",
                    fontSize: "16px",
                  }}
                >
                  ✕
                </span>
              ) : (
                <span style={{ position: "absolute", right: "14px", top: "11px", color: "#aaa" }}>
                </span>
              )}
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: "2px" }}>
              {["สถานีชาร์จ", "กำลังไฟ", "หัวจ่าย", "เครือข่าย"].map((tab) => (
                <div
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "10px 0",
                    fontSize: "12px",
                    cursor: "pointer",
                    color: activeTab === tab ? DARK : "#999",
                    fontWeight: activeTab === tab ? 700 : 400,
                    borderBottom:
                      activeTab === tab ? `3px solid ${YELLOW}` : "3px solid transparent",
                    transition: "0.2s",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tab}
                </div>
              ))}
            </div>
          </div>

          {/* TAB CONTENT */}
          <div
            style={{
              padding: "16px 20px",
              borderBottom: `1px solid ${BORDER}`,
              minHeight: "80px",
              maxHeight: "150px",
            }}
          >
            {activeTab === "สถานีชาร์จ" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {[
                  { label: "เปิดให้บริการ", active: true },
                  { label: "ไม่มีเครื่องว่าง", active: true },
                  { label: "ปิดบริการ", active: true },
                  { label: "ส่วนบุคคล", active: false },
                ].map((item) => (
                  <button
                    key={item.label}
                    style={{
                      padding: "9px 12px",
                      backgroundColor: item.active ? YELLOW : "#fff",
                      border: item.active ? `1px solid ${YELLOW}` : `1px solid ${BORDER}`,
                      borderRadius: "25px",
                      fontSize: "12px",
                      fontWeight: item.active ? 700 : 400,
                      cursor: "pointer",
                      color: item.active ? DARK : "#888",
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            {activeTab === "กำลังไฟ" && (
              <div style={{ padding: "8px 0" }}>
                <div style={{ marginBottom: "8px", fontSize: "13px", color: "#555", fontWeight: 600 }}>
                  กำลังไฟขั้นต่ำ:{" "}
                  <span style={{ color: DARK, fontWeight: 800 }}>{powerFilter} kW</span>
                </div>
                <input
                  type="range"
                  min="7"
                  max="200"
                  value={powerFilter}
                  onChange={(e) => setPowerFilter(Number(e.target.value))}
                  style={{ width: "100%", accentColor: YELLOW, cursor: "pointer" }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "11px",
                    color: "#aaa",
                    marginTop: "4px",
                  }}
                >
                  <span>7 kW (AC)</span>
                  <span>200 kW (DC)</span>
                </div>
              </div>
            )}

            {/* TAB หัวจ่าย: เปลี่ยนจากปุ่มข้อความ+อิโมจิ เป็นแบบมีโลโก้ภาพ */}
            {activeTab === "หัวจ่าย" && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                  maxHeight: "120px",
                  overflowY: "auto",
                }}
              >
                {Object.keys(CONNECTOR_LOGOS).map((type) => (
                  <button
                    key={type}
                    onClick={() => toggleConnector(type)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "25px",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      backgroundColor: selectedConnectors.includes(type) ? YELLOW : "#fff",
                      border: selectedConnectors.includes(type)
                        ? `1px solid ${YELLOW}`
                        : `1px solid ${BORDER}`,
                      fontWeight: selectedConnectors.includes(type) ? 700 : 400,
                      color: DARK,
                    }}
                  >
                    <img
                      src={CONNECTOR_LOGOS[type]}
                      alt={type}
                      style={{
                        height: "20px",
                        width: "auto",
                        objectFit: "contain",
                      }}
                      onError={(e) => {
                        // ป้องกันภาพแตกถ้าหาไฟล์ไม่เจอ
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <span>{type}</span>
                  </button>
                ))}
              </div>
            )}

            {activeTab === "เครือข่าย" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {[
                  { name: "EleX by EGAT", count: "60 สถานี" },
                  { name: "BackEN EV", count: "40 สถานี" },
                  { name: "PEA VOLTA", count: "30 สถานี" },
                  { name: "SHARGE", count: "25 สถานี" },
                ].map((net) => (
                  <div
                    key={net.name}
                    style={{
                      padding: "12px 10px",
                      backgroundColor: YELLOW,
                      borderRadius: "10px",
                      cursor: "pointer",
                      border: `1px solid #e5c100`,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: "13px", color: DARK }}>
                      {net.name}
                    </div>
                    <div style={{ fontSize: "11px", color: "#555", marginTop: "3px" }}>
                      {net.count}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* STATION LIST */}
          <div ref={listRef} style={{ flex: 1, overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "#aaa" }}>
                <div style={{ fontSize: "28px", marginBottom: "10px" }}>⚡</div>
                กำลังโหลดสถานีชาร์จ...
              </div>
            ) : filteredStations.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "#aaa" }}>
                {searchQuery
                  ? `ไม่พบผลการค้นหา "${searchQuery}"`
                  : `ไม่พบสถานีในรัศมี ${radiusKm} กม.`}
              </div>
            ) : (
              filteredStations.map((s) => (
                <StationCard
                  key={s.id}
                  station={s}
                  isSelected={selectedStation?.id === s.id}
                  onSelect={() => handleSelectStation(s)}
                  routeInfo={selectedStation?.id === s.id ? routeInfo : null}
                  routeLoading={selectedStation?.id === s.id ? routeLoading : false}
                  amenityLoading={selectedStation?.id === s.id ? amenityLoading : false}
                  onClearRoute={clearRoute}
                />
              ))
            )}
          </div>
        </div>

        {/* ===== RIGHT: MAP ===== */}
        <div style={{ flex: 1, position: "relative" }}>
          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "100%" }}
              center={currentLocation}
              zoom={11}
              onLoad={(map) => setMapRef(map)}
              options={{
                disableDefaultUI: false,
                zoomControl: true,
                mapTypeControl: true,
                fullscreenControl: true,
                streetViewControl: false,
                styles: [
                  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
                ],
              }}
            >
              {/* My Location */}
              <Marker
                position={currentLocation}
                icon={{
                  url: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png",
                  scaledSize: new google.maps.Size(40, 40),
                }}
                title="ตำแหน่งของคุณ"
                zIndex={999}
              />

              {/* Search radius circle */}
              {!directions && (
                <Circle
                  center={currentLocation}
                  radius={radiusKm * 1000}
                  options={{
                    fillColor: "#0070f3",
                    fillOpacity: 0.04,
                    strokeColor: "#0070f3",
                    strokeOpacity: 0.25,
                    strokeWeight: 1.5,
                  }}
                />
              )}

              {/* Station markers */}
              {filteredStations.map((s) => (
                <Marker
                  key={s.id}
                  position={{ lat: s.lat, lng: s.lng }}
                  title={s.name}
                  onClick={() => handleSelectStation(s)}
                  icon={{
                    url:
                      selectedStation?.id === s.id
                        ? "http://maps.google.com/mapfiles/ms/icons/yellow-dot.png"
                        : "http://maps.google.com/mapfiles/ms/icons/green-dot.png",
                    scaledSize: new google.maps.Size(36, 36),
                  }}
                  zIndex={selectedStation?.id === s.id ? 100 : 1}
                />
              ))}

              {/* Route */}
              {directions && (
                <DirectionsRenderer
                  directions={directions}
                  options={{
                    suppressMarkers: false,
                    polylineOptions: {
                      strokeColor: "#FFD600",
                      strokeWeight: 5,
                      strokeOpacity: 0.9,
                    },
                  }}
                />
              )}
            </GoogleMap>
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#e9ecef",
                fontSize: "18px",
                color: "#888",
              }}
            >
              ⚡ กำลังโหลดแผนที่...
            </div>
          )}

          {/* Route Info Overlay */}
          {routeInfo && selectedStation && (
            <div
              style={{
                position: "absolute",
                bottom: "24px",
                left: "50%",
                transform: "translateX(-50%)",
                backgroundColor: "white",
                borderRadius: "16px",
                padding: "16px 24px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                display: "flex",
                alignItems: "center",
                gap: "24px",
                minWidth: "360px",
                border: `2px solid ${YELLOW}`,
              }}
            >
              <div>
                <div style={{ fontSize: "11px", color: "#888", marginBottom: "2px" }}>
                  ไปยัง: {selectedStation.name}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "20px", marginTop: "4px" }}>
                  <div>
                    <div style={{ fontSize: "22px", fontWeight: 900, color: DARK }}>
                      {routeInfo.distance_text || `${routeInfo.distance_km} กม.`}
                    </div>
                    <div style={{ fontSize: "11px", color: "#888" }}>ระยะทาง</div>
                  </div>
                  <div style={{ width: "1px", height: "36px", backgroundColor: BORDER }} />
                  <div>
                    <div style={{ fontSize: "22px", fontWeight: 900, color: DARK }}>
                      {routeInfo.duration_text || `${Math.round(routeInfo.duration_min)} นาที`}
                    </div>
                    <div style={{ fontSize: "11px", color: "#888" }}>เวลาเดินทาง</div>
                  </div>
                </div>
              </div>
              <button
                onClick={clearRoute}
                style={{
                  marginLeft: "auto",
                  padding: "8px 16px",
                  backgroundColor: "#f0f0f0",
                  border: "none",
                  borderRadius: "20px",
                  cursor: "pointer",
                  fontSize: "12px",
                  color: "#555",
                  fontWeight: 600,
                }}
              >
                ✕ ล้างเส้นทาง
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== STATION CARD COMPONENT =====
function StationCard({
  station,
  isSelected,
  onSelect,
  routeInfo,
  routeLoading,
  amenityLoading,
  onClearRoute,
}: {
  station: Station;
  isSelected: boolean;
  onSelect: () => void;
  routeInfo: RouteInfo | null;
  routeLoading: boolean;
  amenityLoading: boolean;
  onClearRoute: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        padding: "18px 20px",
        borderBottom: `1px solid ${BORDER}`,
        backgroundColor: isSelected ? "#fffbea" : "white",
        cursor: "pointer",
        transition: "background-color 0.15s",
        borderLeft: isSelected ? `4px solid ${YELLOW}` : "4px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = "#fafafa";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = "white";
      }}
    >
      {/* Row 1: Name + Distance */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "6px",
        }}
      >
        <div style={{ flex: 1, paddingRight: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: DARK, lineHeight: "1.3" }}>
            {station.name}
          </h3>
          <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#888", lineHeight: "1.4" }}>
            {station.address}
          </p>
        </div>
        <div style={{ textAlign: "center", minWidth: "60px" }}>
          <div
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "50%",
              border: isSelected ? `2px solid ${YELLOW}` : `1.5px solid #ddd`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginLeft: "auto",
              backgroundColor: isSelected ? YELLOW : "white",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isSelected ? DARK : "#888"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <div style={{ fontSize: "10px", color: "#888", marginTop: "3px" }}>
            {routeLoading ? "..." : `${station.distance_km} กม.`}
          </div>
        </div>
      </div>

      {/* Row 2: Time & Type */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: isSelected ? "10px" : "0",
        }}
      >
        <span style={{ fontSize: "11px", color: "#00a651", fontWeight: 600 }}>
          {station.time}
        </span>
        {station.type && (
          <span
            style={{
              fontSize: "10px",
              backgroundColor: station.type.includes("DC") ? "#fff3cd" : "#d4edda",
              color: station.type.includes("DC") ? "#856404" : "#155724",
              padding: "2px 7px",
              borderRadius: "10px",
              fontWeight: 600,
            }}
          >
            {station.type}
          </span>
        )}
      </div>

      {/* EXPANDED: when selected */}
      {isSelected && (
        <div
          style={{
            marginTop: "10px",
            padding: "12px",
            backgroundColor: "white",
            borderRadius: "10px",
            border: `1px solid ${BORDER}`,
          }}
        >
          {/* Route info */}
          {routeLoading ? (
            <div style={{ fontSize: "12px", color: "#aaa", textAlign: "center", padding: "8px" }}>
              กำลังคำนวณเส้นทาง...
            </div>
          ) : routeInfo ? (
            <div
              style={{
                display: "flex",
                gap: "16px",
                marginBottom: "12px",
                padding: "10px 0",
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: "18px", fontWeight: 900, color: DARK }}>
                  {routeInfo.distance_text || `${routeInfo.distance_km} กม.`}
                </div>
                <div style={{ fontSize: "10px", color: "#999" }}>ระยะทาง</div>
              </div>
              <div style={{ width: "1px", backgroundColor: BORDER }} />
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: "18px", fontWeight: 900, color: DARK }}>
                  {routeInfo.duration_text || `${Math.round(routeInfo.duration_min)} น.`}
                </div>
                <div style={{ fontSize: "10px", color: "#999" }}>เวลาเดินทาง</div>
              </div>
            </div>
          ) : null}

          {/* Amenities */}
          <div style={{ marginBottom: "10px" }}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#555",
                marginBottom: "8px",
              }}
            >
              สิ่งอำนวยความสะดวกในรัศมี 500 ม.
            </div>
            {amenityLoading ? (
              <div style={{ fontSize: "11px", color: "#aaa" }}>กำลังค้นหา...</div>
            ) : station.amenities ? (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <AmenityBadge icon="/image/icn-toilet.png" label="ห้องน้ำ" available={station.amenities.toilets} />
                <AmenityBadge icon="/image/icn-coffee.png" label="ร้านกาแฟ" available={station.amenities.cafe} />
                <AmenityBadge icon="/image/icn-food.png" label="ร้านอาหาร" available={station.amenities.restaurant} />
                <AmenityBadge icon="/image/icn-mall.png" label="ห้าง" available={station.amenities.mall} /> 
                <AmenityBadge icon="/image/icn-hotel.jpeg" label="โรงแรม" available={station.amenities.hotel} />
                <AmenityBadge icon="/image/icn-hospital.jpg" label="โรงพยาบาล" available={station.amenities.hospital} />
                <AmenityBadge icon="/image/icn-bank.jpg" label="ธนาคาร" available={station.amenities.bank} />
                <AmenityBadge icon="/image/icn-pharmacy.webp" label="ร้านยา" available={station.amenities.pharmacy} />
                <AmenityBadge icon="/image/icn-convenience.jpg" label="ร้านสะดวกซื้อ" available={station.amenities.convenience} />
              </div>
            ) : (
              <div style={{ fontSize: "11px", color: "#aaa" }}>คลิกเพื่อโหลดข้อมูล</div>
            )}
          </div>

          {/* Navigate Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.open(
                `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}&travelmode=driving`,
                "_blank"
              );
            }}
            style={{
              width: "100%",
              padding: "10px",
              backgroundColor: YELLOW,
              border: "none",
              borderRadius: "25px",
              fontWeight: 700,
              fontSize: "13px",
              cursor: "pointer",
              color: DARK,
              marginBottom: "6px",
            }}
          >
            นำทางใน Google Maps
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearRoute();
            }}
            style={{
              width: "100%",
              padding: "8px",
              backgroundColor: "transparent",
              border: `1px solid ${BORDER}`,
              borderRadius: "25px",
              fontSize: "12px",
              cursor: "pointer",
              color: "#888",
            }}
          >
            ✕ ล้างเส้นทาง
          </button>
        </div>
      )}
    </div>
  );
}

// ===== AMENITY BADGE =====
function AmenityBadge({
  icon,
  label,
  available,
}: {
  icon: string; // ตรงนี้ icon จะรับค่าเป็นพาธรูปภาพ เช่น "/image/icn-toilet.png"
  label: string;
  available: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 9px",
        borderRadius: "20px",
        fontSize: "11px",
        fontWeight: 600,
        backgroundColor: available ? "#e8f5e9" : "#f5f5f5",
        color: available ? "#2e7d32" : "#bbb",
        border: `1px solid ${available ? "#c8e6c9" : "#e0e0e0"}`,
      }}
    >
      {/* เช็คว่ามีคำว่า "/" ใน icon ไหม ถ้ามีให้แสดงเป็นแท็ก img ถ้าไม่มี (เผื่อหลงเหลืออิโมจิ) ให้แสดงเป็น text ปกติ */}
      {icon.includes("/") ? (
        <img 
          src={icon} 
          alt={label} 
          style={{ 
            width: "14px", 
            height: "14px", 
            objectFit: "contain",
            // ถ้าอยากให้ไอคอนสีเทาจางลงเวลาไม่มีบริการ (available=false) ให้ใช้ opacity 
            opacity: available ? 1 : 0.5 
          }} 
        />
      ) : (
        <span>{icon}</span>
      )}
      
      <span>{label}</span>
      {available ? (
        <span style={{ color: "#43a047" }}>✓</span>
      ) : (
        <span style={{ color: "#ccc" }}>✗</span>
      )}
    </div>
  );
}