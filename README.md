# Scribble Whiteboard (Realtime + Multiuser)

A collaborative whiteboard with scribble-style drawing, live sync, room sharing, token-protected access, and MongoDB persistence.

## Features
- Realtime multi-user drawing with Socket.IO
- Scribble brush effect
- Room-based collaboration
- Token-protected share links
- Per-user undo/redo
- Canvas clear synced to all users in room
- MongoDB persistence (optional fallback to memory if DB unavailable)

## Requirements
- Node.js 18+
- MongoDB (optional but required for persistence)

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create your env file:
   ```bash
   copy .env.example .env
   ```
3. Edit `.env` if needed:
   - `PORT` default: `3000`
   - `MONGODB_URI` default: `mongodb://127.0.0.1:27017/scribble_whiteboard`

## Run
```bash
npm start
```
Open: `http://localhost:3000`

## Share a Room
1. Enter room name and click `Join`
2. Click `Create Share Link`
3. Send generated URL to collaborators

## Notes
- If MongoDB is unavailable, the app still runs with in-memory state (not persisted across restarts).
- Undo/redo applies to the current user's own strokes.

## Publish Publicly (Any Device)

### Option 1: Render (recommended)
1. Push this project to GitHub.
2. Create a MongoDB Atlas database and copy its connection string.
3. In Render:
   - `New +` -> `Blueprint`
   - Select your GitHub repo
   - Render will detect `render.yaml`
4. Set environment variable in Render:
   - `MONGODB_URI=<your atlas connection string>`
5. Deploy. Render gives you a URL like:
   - `https://your-app-name.onrender.com`

Anyone can open that URL on phone/laptop.

### Option 2: Same Wi-Fi only (quick local)
1. Start app:
   ```bash
   npm start
   ```
2. Find your PC IP:
   ```bash
   ipconfig
   ```
3. Open from another device on same network:
   - `http://<your-local-ip>:3000`
