$ErrorActionPreference = "Stop"

# 1) BE1 (Node/Hapi)
Push-Location services/api
npm install
start powershell -NoExit -Command "npm run dev"
Pop-Location

# 2) BE2 (FastAPI)
Push-Location services/ml
python -m venv .venv
. .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
start powershell -NoExit -Command "uvicorn app:app --reload --host 0.0.0.0 --port 5000"
deactivate
Pop-Location

# 3) Frontend (Vite)
Push-Location frontend
npm install
start powershell -NoExit -Command "npm run dev"
Pop-Location
