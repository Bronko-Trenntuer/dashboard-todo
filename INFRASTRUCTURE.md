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
- **Vollständige Zonen-Einträge (verifiziert 2026-08-18 per Screenshot, TTL jeweils 86400s):**

| Name | Typ | Ziel |
|---|---|---|
| `ema-industrie.de.` | NS | `ns.ema-industrie.de.` |
| `ema-industrie.de.` | A | `217.160.0.104` (öffentlich, vermutlich Website/Hosting) |
| `www.ema-industrie.de.` | A | `217.160.0.104` |
| `ns.ema-industrie.de.` | A | `192.168.178.100` |
| `autodiscover.ema-industrie.de.` | CNAME | `adsredir.ionos.info.` (Microsoft-365-Autodiscover) |
| `dashboard.ema-industrie.de.` | A | `192.168.178.70` |
| `dashboard-todo.ema-industrie.de.` | A | `192.168.178.70` |
| `portal.ema-industrie.de.` | A | `192.168.178.70` |
| `drive.ema-industrie.de.` | A | `192.168.178.100` |

**Bei neuem Dashboard:** neuen A-Record `<name>.ema-industrie.de` → `192.168.178.70` anlegen (intern). Falls extern nötig: separat klären, ob über NAS-Reverse-Proxy (Port 8443-Modell) oder ausschließlich intern/VPN.

---

## 3. Reverse Proxy — Caddy (Docker, auf dem Mac mini)

**Bestätigter Fakt (verifiziert 2026-08-18):** Caddy läuft als eigener Docker-Container auf dem Mac mini, gestartet über `docker compose` (Datei: `/Users/mac-ema/caddy/docker-compose.yml`) — nicht mehr per manuellem `docker run`. Dadurch ist der Container-Zustand jetzt reproduzierbar dokumentiert statt nur "live gewachsen".

```
Container: caddy (Image: caddy:latest)
Gestartet über: /Users/mac-ema/caddy/docker-compose.yml
Ports: 0.0.0.0:80->80/tcp
Mounts:
  - /Users/mac-ema/caddy/Caddyfile → /etc/caddy/Caddyfile
  - /Users/mac-ema/caddy/portal    → /srv/portal
Netzwerke (beide bestätigt, verifiziert 2026-08-18):
  - caddy-net (172.19.0.2)             — für alle künftigen Dashboard-Container
  - dashboard-ema_default (172.18.0.3) — bestehendes Netzwerk des EMA-Dashboards (auktionsboard)
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

**Reload nach Änderung (normalerweise kein Neustart nötig):**
```
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

**Bekannte Falle (aufgetreten 2026-08-18 beim `dashboard-todo`-Rollout):** Der Reload lief ohne Fehlermeldung durch (Logs sahen unauffällig aus), aber der neue Site-Block wurde **nicht wirklich in die laufende Konfiguration übernommen** — Anfragen an den neuen Hostnamen verhielten sich identisch zu einem komplett unbekannten/erfundenen Hostnamen (`200 OK`, `Content-Length: 0`), obwohl der Block in der Datei korrekt vorhanden war. Diagnose: neuen Host UND einen frei erfundenen Host testweise mit identischem Host-Header direkt gegen `localhost` abfragen (`curl -H "Host: <name>" http://localhost/` auf dem Mac mini) — liefern beide dasselbe Leer-Ergebnis, während ein bekannter, funktionierender Host (`dashboard.ema-industrie.de`) echten Inhalt zurückgibt, ist der neue Block trotz korrekter Datei nicht aktiv. **Fix:** vollen Container-Neustart statt Reload:
```
docker restart caddy
```
Das betrifft kurz **alle** dahinterliegenden Dashboards (Sekunden Downtime), behebt es aber zuverlässig. Nach jedem neuen Caddyfile-Block sicherheitshalber direkt so gegentesten, statt sich auf den Reload-Log allein zu verlassen.

---

## 4. Docker-Netzwerk

```
docker network create caddy-net
docker network connect caddy-net caddy
```
**Status (verifiziert 2026-08-18 via `docker network ls` + `docker inspect caddy`):** `caddy-net` wurde neu angelegt und Caddy erfolgreich verbunden. Caddy ist jetzt in **beiden** Netzwerken aktiv: `caddy-net` und `dashboard-ema_default`. Da Caddy per Compose läuft (siehe Abschnitt 3), ist `caddy-net` zusätzlich fest in der `docker-compose.yml` als `external: true` eingetragen — bleibt also auch nach einem Neuaufbau des Containers erhalten.
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
| Dashboard-Todo | dashboard-todo.ema-industrie.de | dashboard-todo | 5100 | Live |
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

1. **DNS:** A-Record auf Synology NAS anlegen (`<name>.ema-industrie.de` → 192.168.178.70) — **als aller ersten Schritt, vor jeder weiteren Aktion.** Mit `dig <name>.ema-industrie.de @192.168.178.100` verifizieren, dass die NAS selbst korrekt antwortet, **bevor** der Name irgendwo sonst berührt wird (Browser-Aufruf, Portalseiten-Kachel, Caddyfile-Block aktivieren, Status-Check-Skript). Der negative Cache entsteht dadurch, dass irgendetwas den Namen abfragt, *bevor* der Eintrag existiert — nicht durch das bloße Anlegen selbst. Danach gilt: bis zu 3h einplanen, bevor der Name über die FritzBox/VPN sichtbar wird, falls doch schon vorher abgefragt wurde (siehe Abschnitt 10).
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

## 9. GitHub-Struktur

- **Account:** `Bronko-Trenntuer`
- **Prinzip:** Ein Repo pro Dashboard (kein Mono-Repo)
- **Sichtbarkeit:** Alle Repos **privat**
- Bestätigtes Beispiel: `Bronko-Trenntuer/dashboard-todo`
- Deploy-Workflow (aus bisherigen Rollouts): `git clone` auf den Mac mini → eigener Docker-Compose-Service → Update über `update-<name>.sh`-Skript (`git pull` + `docker compose up --build -d`)

> Offen/zu klären bei Gelegenheit: vollständige Repo-Liste (welche Dashboards haben schon ein Repo), ob es ein separates Repo für Caddy/Portal/Infra-Konfiguration gibt oder ob das nur lokal auf dem Mac mini liegt, Branching-Strategie, CI/CD (aktuell nicht bekannt, vermutlich keins).

---

## 9a. Update-Skripte (`~/bin/` auf dem Mac mini)

Diese Skripte liegen nur lokal auf dem Mac mini (nicht Teil eines Git-Repos) — hier als Referenz/Backup dokumentiert, damit ihr Inhalt nicht ausschließlich auf dem einen Rechner existiert.

**`~/bin/update-dashboard.sh`** (Haupt-Dashboard, EMA/Auktionsboard):
```bash
#!/bin/bash
cd ~/dashboard-ema
git pull
docker compose up --build -d
```

**`~/bin/update-dashboard-todo.sh`** (dieses Todo-Dashboard):
```bash
#!/bin/bash
cd ~/dashboard-todo
git pull
docker compose up --build -d
```

Beide folgen demselben Muster (siehe Abschnitt 8, Schritt 7) — bei jedem neuen Dashboard ein analoges `update-<name>.sh` anlegen und hier eintragen.

---

## 10. Offene / bekannte Punkte (Stand siehe Datum oben)

- TigerVNC-Performance: externe VPN-Verbindung schneller als lokaler Netzwerkzugriff — Ursache ungeklärt
- Synology File Station: gelöschte Ordner tauchen wegen bidirektionalem Cloud Sync mit SharePoint wieder auf
- Mac mini LaunchAgent-Startskript: soll robuster werden, damit fehlgeschlagene SMB-Mounts Docker-Start nicht kompromittieren
- Backup-Mechanismus für `dashboard-todo`: aktuell kein automatisches Backup (nur manueller Export) — Nachrüsten (versionierte Kopien + NAS-Spiegelung, analog EMA-Dashboard) besprochen, aber noch nicht umgesetzt
- Internes HTTPS: aktuell laufen alle internen Dashboards über `http://` (Caddy Port 80) — falls später auf HTTPS umgestellt wird, müssen Caddyfile, Portalseiten-Links und SERVICES-URLs gemeinsam angepasst werden
- **Negativer DNS-Cache bei neuen Einträgen (FritzBox):** Verifiziert 2026-08-18 — wenn ein neuer DNS-Eintrag auf der NAS angelegt wird, kann die FritzBox einen vorher gecachten NXDOMAIN (aus einer Abfrage vor Anlage des Eintrags) bis zu **3 Stunden** (negative-Cache-TTL laut SOA-Record: `10800s`, siehe `dig ema-industrie.de SOA @192.168.178.100`) weiter ausliefern, obwohl die NAS selbst längst korrekt antwortet (verifizierbar via `dig <name>.ema-industrie.de @192.168.178.100`). **Wichtig:** Ein "Internet trennen/neu verbinden" in der FritzBox-Oberfläche (Internet → Online-Monitor) behebt das **nicht** — das erneuert nur die WAN-Verbindung, nicht den internen DNS-Resolver-Cache. Getestet und bestätigt wirkungslos. **Praktischer Umgang:** Nach Anlage eines neuen DNS-Eintrags bis zu 3h einplanen, bevor er über die FritzBox (und damit für VPN-Clients) sichtbar ist. Für sofortigen eigenen Zugriff: lokaler `hosts`-Datei-Eintrag (`192.168.178.70 <name>.ema-industrie.de` in `C:\Windows\System32\drivers\etc\hosts`) als Workaround, betrifft nur den eigenen Rechner.

---

## 11. Grundregel für zukünftige Chats

Bei jedem neuen Infrastruktur-Thema: **erst diese Datei (bzw. aktuelle Befehlsausgaben wie `docker ps -a`, `docker inspect <container>`, `cat Caddyfile`) prüfen, dann planen** — nicht umgekehrt. Wenn sich seit der letzten Aktualisierung etwas geändert hat, das hier nicht (mehr) stimmt, das explizit vermerken statt stillschweigend zu überschreiben.
