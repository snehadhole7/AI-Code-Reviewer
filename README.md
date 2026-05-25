<<<<<<< HEAD
# AI Code Reviewer

A placement-ready AI code review project with a dashboard frontend and FastAPI backend.

## Features

- Email signup/login with JWT-style bearer tokens
- Upload file, paste source code, or enter a GitHub repository URL
- FastAPI review endpoints
- Gemini API integration when `GEMINI_API_KEY` is configured
- Local analyzer fallback for demos without an API key
- MongoDB report history when `MONGODB_URI` is configured
- Local JSON storage fallback for demos without MongoDB
- Dashboard charts, severity-style sections, optimized code, PDF print, and DOC export

## Run Frontend

```powershell
node server.js
```

Open:

```text
http://127.0.0.1:5173
```

## Run Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend docs:

```text
http://127.0.0.1:8000/docs
```

## Gemini Setup

Set your API key before starting the backend:

```powershell
$env:GEMINI_API_KEY="your_key_here"
uvicorn main:app --reload --port 8000
```

Without a Gemini key, the backend still works using the local analyzer fallback.

## MongoDB Setup

For local demos without MongoDB, reports are saved in `backend/data/*.json`.

To use MongoDB, set:

```powershell
$env:MONGODB_URI="mongodb://127.0.0.1:27017"
$env:MONGODB_DB="ai_code_reviewer"
uvicorn main:app --reload --port 8000
```

## Resume Line

Built an AI-powered code review platform using FastAPI, JWT authentication, Gemini API, and a responsive dashboard to detect bugs, security risks, performance issues, and generate downloadable review reports.
=======
# AI-Code-Reviewer
>>>>>>> ee44b80a15103af3929817b6dd1eaa98a85038c4
