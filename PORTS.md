# Port-Registry Mac mini

Übersicht aller lokal auf dem Mac mini laufenden Dashboard-Container und ihrer
Host-Ports. Caddy läuft nativ auf dem Mac mini und spricht jeden Container
über seinen veröffentlichten Host-Port an (kein gemeinsames Docker-Netzwerk).

Vor der Vergabe eines neuen Ports: `docker ps` und die Caddyfile prüfen, ob
der Port nicht bereits (auch von einem Nicht-Docker-Dienst) belegt ist. Neue
Ports einfach fortlaufend hochzählen.

| Port | Dashboard      | Repo               | Domain/Subdomain (Caddy) |
|------|----------------|---------------------|--------------------------|
| 5050 | auktionsboard  | ~/dashboard-ema      | (siehe Caddyfile)        |
| 8130 | dashboard-todo | ~/dashboard-todo     | (siehe Caddyfile)        |

Nächster freier Port: **8131**
