# EMA Infrastruktur — Referenz

> Zweck: Diese Datei ist die verbindliche Ist-Zustand-Referenz für die gesamte EMA-IT-Infrastruktur.
> Vor jedem neuen Dashboard-Rollout wird diese Datei zuerst gelesen (nicht rekonstruiert/vermutet),
> und nach jeder Änderung aktualisiert. Stand: siehe "Letzte Aktualisierung" unten.

**Letzte Aktualisierung:** 2026-08-18

---

## 1. Hardware & Netzwerk

| Komponente | Adresse | Rolle |
|---|---|---|
| Mac mini | `192.168.178.70` | Zentraler Docker-Host, läuft Caddy + alle Dashboard-Container |
| Synology NAS (DS224+) | `192.168.178.100` | DNS-Server (Split-DNS), File Station, Synology Drive, Backup-Ziel |
| FritzBox | Router | DHCP-Reservierungen, WireGuard-VPN, Port-Forwarding |

**Fester Zugriff:**
- Mac mini hat feste IP via FritzBox-DHCP-Reservierung
- Zugriff aufs interne Netz von extern: WireGuard-VPN via FritzBox
- Externe Live-URL (Sonderfall, außerhalb Caddy): `https://ema-industrie.synology.me:8443/` → NAS DSM Reverse-Proxy → intern `192.168.178.70:5050`

**Port-Forwarding (FritzBox), Stand nach Security-Audit:**
- Nur HTTPS und Synology Drive sind extern offen — alles andere wurde entfernt

---

## 2. DNS (Synology DNS Server)

- Synology NAS ist autoritativer Nameserver für die Zone **`ema-industrie.de`**
- Split-DNS: intern und extern werden Subdomains unterschiedlich aufgelöst
- Bestehende Einträge:
  - `dashboard.ema-industrie.de` → 192.168.178.70
  - `portal.ema-industrie.de` → 192.168.178.70
  - `drive.ema-industrie.de` → NAS (Synology Drive)

**Bei neuem Dashboard:** neuen A-Record `<name>.ema-industrie.de` → `192.168.178.70` anlegen (intern). Falls extern nötig: separat klären, ob über NAS-Reverse-Proxy (Port 8443-Modell) oder ausschließlich intern/VPN.

---

## 3. Reverse Proxy — Caddy (Docker, auf dem Mac mini)

**Bestätigter Fakt (nicht mehr annehmen!):** Caddy läuft als eigener Docker-Container auf dem Mac mini, **nicht** nativ.

```
Container: caddy (Image: caddy:latest)
Ports: 0.0.0.0:80->80/tcp
Mounts:
  - /Users/mac-ema/caddy/Caddyfile → /etc/caddy/Caddyfile
  - /Users/mac-ema/caddy/portal    → /srv/portal
Netzwerk: caddy-net (gemeinsames Docker-Netzwerk für Caddy + alle Dashboards)
```

**Aktuelle Caddyfile (Stand: siehe Datum oben):**
```
dashboard.ema-industrie.de:80 {
    reverse_proxy auktionsboard:5000
}
portal.ema-industrie.de:80 {
    root * /srv/portal
    file_server
}
dashboard-todo.ema-industrie.de:80 {
    reverse_proxy dashboard-todo:5100
}
```

**Wichtig:** Caddy erreicht die Dashboard-Container über den **Container-Namen im gemeinsamen Docker-Netzwerk** (`caddy-net`), nicht über Host-Ports. Jeder neue Dashboard-Container muss diesem Netzwerk beitreten.

**Reload nach Änderung (kein Neustart nötig):**
```
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## 4. Docker-Netzwerk

```
docker network create caddy-net   # einmalig, bereits erledigt
docker network connect caddy-net caddy   # Caddy ist bereits Mitglied
```
Jedes neue Dashboard-Compose-File muss `caddy-net` als externes Netzwerk einbinden, damit Caddy es per Containername erreichen kann.

---

## 5. Port-Konvention

Bereichs-basiertes Schema, damit der Port allein schon die Kategorie eines Dienstes verrät und keine Kollisionen zwischen Live/Verwaltung/Staging entstehen. Gilt für den **internen Container-Port** (Caddy spricht Container ohnehin über Namen im `caddy-net` an — Host-Port-Mapping ist nicht mehr nötig; die Konvention dient nur der Übersicht/Vermeidung doppelter interner Ports).

| Bereich | Zweck | Belegt |
|---|---|---|
| `5000–5099` | Produktive Kern-Dashboards (Kerngeschäft: Verwertungssteuerung, Auktionen) | `5000` = auktionsboard |
| `5100–5199` | Interne Verwaltungs-/Support-Dashboards (Todo, Gutachten, Abholungen) | `5100` = dashboard-todo |
| `5200–5299` | Reserve für weitere fachliche Dashboards | — |
| `8000–8099` | Interne Tools ohne Dashboard-Charakter (z. B. Monitoring, Admin-UIs) | — |
| `9000–9099` | Staging/Test-Instanzen vor Live-Schaltung | — |

**Bei neuem Dashboard:** nächsten freien Port im passenden Bereich vergeben und hier sowie in Abschnitt 6 (Übersichtstabelle) eintragen.

---

## 6. Bestehende Dashboards (Übersicht)

| Name | Subdomain | Container-Name | Interner Port | Status |
|---|---|---|---|---|
| EMA-Dashboard (Auktionsboard) | dashboard.ema-industrie.de | auktionsboard | 5000 | Live |
| Dashboard-Todo | dashboard-todo.ema-industrie.de | dashboard-todo | 5100 | Noch nicht aktiv |
| Gutachten-Dashboard | — | — | — | In Einrichtung (Umzug intern geplant) |
| Abholungen-Dashboard | — | — | — | In Einrichtung |

> Diese Tabelle bei jedem Rollout/Umzug aktualisieren.

---

## 7. Portalseite (`portal.ema-industrie.de`)

- Statische `index.html`, ausgeliefert von Caddy via `/srv/portal` (File-Server-Block)
- Enthält: Uhr/Wetter-Header, Systemstatus-Strip (Client-seitiger `no-cors`-Erreichbarkeitscheck), Kachel-Grid der Dashboards, Quicklinks (SharePoint, Synology Drive)

**Bei neuem Dashboard zwei Stellen anpassen:**
1. Neue `<a class="tile" ...>` im `.tiles`-Grid mit `data-status-target="<id>"`
2. Neuer Eintrag im `SERVICES`-Array (JS): `{ id:'<id>', label:'<Anzeigename>', type:'check', url:'http://<name>.ema-industrie.de' }`

**Hinweis:** Der Erreichbarkeits-Check läuft im Browser des Nutzers (Client-seitig), nicht serverseitig — setzt daher voraus, dass der aufrufende Rechner selbst Netzwerkzugriff (intern/VPN) auf die Subdomain hat.

---

## 8. Standard-Workflow: Neues Dashboard hinzufügen

1. **DNS:** A-Record auf Synology NAS anlegen (`<name>.ema-industrie.de` → 192.168.178.70)
2. **Port vergeben:** nächsten freien Port im passenden Bereich wählen (siehe Abschnitt 5, Port-Konvention)
3. **Projekt vorbereiten:** Repo/Ordner auf dem Mac mini anlegen, Docker-Compose-Service definieren, `caddy-net` als externes Netzwerk einbinden
4. **Starten:** `docker compose up --build -d`
5. **Caddyfile erweitern** um neuen Block, dann `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`
6. **Portalseite aktualisieren:** Kachel + SERVICES-Eintrag ergänzen (siehe Abschnitt 7)
7. **Update-Skript anlegen** (Beispielmuster):
   ```bash
   cat > ~/bin/update-<name>.sh << 'EOF'
   #!/bin/bash
   cd ~/<name>
   git pull
   docker compose up --build -d
   EOF
   chmod +x ~/bin/update-<name>.sh
   ```
8. **Diese Datei aktualisieren:** neuen Eintrag in Abschnitt 5 (Port-Konvention) + Abschnitt 6 (Übersichtstabelle) + DNS-Liste in Abschnitt 2 + Caddyfile-Stand in Abschnitt 3

---

## 9. Offene / bekannte Punkte (Stand siehe Datum oben)

- TigerVNC-Performance: externe VPN-Verbindung schneller als lokaler Netzwerkzugriff — Ursache ungeklärt
- Synology File Station: gelöschte Ordner tauchen wegen bidirektionalem Cloud Sync mit SharePoint wieder auf
- Mac mini LaunchAgent-Startskript: soll robuster werden, damit fehlgeschlagene SMB-Mounts Docker-Start nicht kompromittieren
- Backup-Mechanismus für `dashboard-todo`: aktuell kein automatisches Backup (nur manueller Export) — Nachrüsten (versionierte Kopien + NAS-Spiegelung, analog EMA-Dashboard) besprochen, aber noch nicht umgesetzt
- Internes HTTPS: aktuell laufen alle internen Dashboards über `http://` (Caddy Port 80) — falls später auf HTTPS umgestellt wird, müssen Caddyfile, Portalseiten-Links und SERVICES-URLs gemeinsam angepasst werden

---

## 10. Grundregel für zukünftige Chats

Bei jedem neuen Infrastruktur-Thema: **erst diese Datei (bzw. aktuelle Befehlsausgaben wie `docker ps -a`, `docker inspect <container>`, `cat Caddyfile`) prüfen, dann planen** — nicht umgekehrt. Wenn sich seit der letzten Aktualisierung etwas geändert hat, das hier nicht (mehr) stimmt, das explizit vermerken statt stillschweigend zu überschreiben.
