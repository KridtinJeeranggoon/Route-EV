"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
// @ts-ignore
import "leaflet/dist/leaflet.css";

interface Station { id: string; name: string; lat: number; lng: number; type: string; address: string; connectors: string; power_kw: number; network: string; time: string; distance_km: number; amenities?: any; }

interface MapViewProps {
  center: { lat: number; lng: number };
  zoom: number;
  currentLocation: { lat: number; lng: number };
  stations: Station[];
  selectedStation: Station | null;
  radiusKm: number;
  routeCoordinates?: [number, number][]; 
  onSelectStation: (station: Station) => void;
}

const stationIcon = L.divIcon({
  className: "",
  html: `<svg viewBox="0 0 24 24" width="36" height="36" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#ffd500" stroke="#000" stroke-width="0.5"/>
  </svg>`,
  iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36],
});

const selectedIcon = L.divIcon({
  className: "",
  html: `<svg viewBox="0 0 24 24" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#ffd500" stroke="#000" stroke-width="1"/>
  </svg>`,
  iconSize: [48, 48], iconAnchor: [24, 48], popupAnchor: [0, -48],
});

const userIcon = L.divIcon({
  className: "",
  html: `<div style="background-color:#4285F4; border:3px solid white; border-radius:50%; width:20px; height:20px; box-shadow: 0 0 8px rgba(0,0,0,0.5);"></div>`,
  iconSize: [20, 20], iconAnchor: [10, 10],
});

export default function MapView({ center, zoom, currentLocation, stations, selectedStation, radiusKm, routeCoordinates, onSelectStation }: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const userGroupRef = useRef<L.LayerGroup | null>(null);
  const routeGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [center.lat, center.lng], zoom, zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    markersGroupRef.current = L.layerGroup().addTo(map);
    userGroupRef.current = L.layerGroup().addTo(map);
    routeGroupRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (mapRef.current && selectedStation) mapRef.current.flyTo([selectedStation.lat, selectedStation.lng], 16, { animate: true, duration: 1.5 });
  }, [selectedStation]);

  useEffect(() => {
    if (!mapRef.current || !userGroupRef.current) return;
    userGroupRef.current.clearLayers();
    L.marker([currentLocation.lat, currentLocation.lng], { icon: userIcon, zIndexOffset: 1000 }).bindTooltip("ตำแหน่งของคุณ", { permanent: false }).addTo(userGroupRef.current);
    if (radiusKm !== 9999) L.circle([currentLocation.lat, currentLocation.lng], { radius: radiusKm * 1000, color: "#4285F4", fillColor: "#4285F4", fillOpacity: 0.04, weight: 1.5, dashArray: "5,5" }).addTo(userGroupRef.current);
  }, [currentLocation, radiusKm]);

  useEffect(() => {
    if (!mapRef.current || !markersGroupRef.current) return;
    markersGroupRef.current.clearLayers();
    stations.forEach((s) => {
      const isSelected = selectedStation?.id === s.id;
      L.marker([s.lat, s.lng], { icon: isSelected ? selectedIcon : stationIcon, zIndexOffset: isSelected ? 500 : 0 })
        .on("click", () => onSelectStation(s)).addTo(markersGroupRef.current!);
    });
  }, [stations, selectedStation, onSelectStation]);

  useEffect(() => {
    if (!mapRef.current || !routeGroupRef.current) return;
    routeGroupRef.current.clearLayers();
    if (routeCoordinates && routeCoordinates.length > 0) {
      const polyline = L.polyline(routeCoordinates, { color: "#ffd500", weight: 6, opacity: 0.9, lineCap: "round" }).addTo(routeGroupRef.current);
      mapRef.current.fitBounds(polyline.getBounds(), { padding: [50, 50] });
    }
  }, [routeCoordinates]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", zIndex: 0 }} />;
}