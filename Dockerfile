FROM python:3.12-slim

WORKDIR /app
COPY public/ /app/

EXPOSE 8123

CMD ["python", "server.py"]
