FROM python:3.13-slim

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir .
COPY catalog_proxy.py main.py ./

CMD ["python", "main.py"]
