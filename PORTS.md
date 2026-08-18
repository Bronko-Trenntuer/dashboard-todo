# Reverse-Proxy-Registry Mac mini

Caddy läuft als eigener Docker-Container (`~/caddy/Caddyfile` auf dem Mac mini,
NICHT Teil dieses oder eines anderen Dashboard-Repos) und erreicht jedes
Dashboard über dessen Container-Namen im gemeinsamen Docker-Netzwerk
**`caddy-net`** — kein Host-Port-Mapping nötig. Jeder Dashboard-Container muss
diesem Netzwerk beitreten (`networks: [caddy-net]` in seiner `docker-compose.yml`,
als `external: true` deklariert).

Vor dem ersten Start eines neuen Dashboards prüfen, ob `caddy-net` existiert
(`docker network ls`) und Caddy dort bereits Mitglied ist
(`docker inspect caddy --format '{{json .NetworkSettings.Networks}}'`).

| Container-Name  | Interner Port | Repo               | Domain (Caddyfile)              |
|------------------|---------------|---------------------|----------------------------------|
| auktionsboard    | 5000          | ~/dashboard-ema      | dashboard.ema-industrie.de       |
| dashboard-todo   | 8123          | ~/dashboard-todo     | dashboard-todo.ema-industrie.de  |

Neue Einträge in der `Caddyfile` folgen dem Muster:
```
<subdomain>.ema-industrie.de:80 {
    reverse_proxy <container-name>:<interner-port>
}
```
Nach jeder Änderung an der Caddyfile: `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.
