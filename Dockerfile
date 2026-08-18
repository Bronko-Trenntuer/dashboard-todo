FROM python:3.12-slim

WORKDIR /app
COPY public/ /app/

EXPOSE 5100

CMD ["python", "server.py"]
