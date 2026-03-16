import express from "express";
import { Server } from "socket.io";
import http from "http";
import { createClient } from "@libsql/client";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import cron from "node-cron";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Turso client
const db = createClient({
  url: process.env.TURSO_URL || "file:rh_conges.db",
  authToken: process.env.TURSO_TOKEN,
});

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.SMTP_HOST) return;
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}

async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT UNIQUE NOT NULL,
      department_id INTEGER,
      FOREIGN KEY (department_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      matricule TEXT UNIQUE,
      role TEXT DEFAULT 'superior',
      department_id INTEGER,
      post_id INTEGER,
      balance INTEGER DEFAULT 25,
      can_request INTEGER DEFAULT 1,
      direct_to_ceo INTEGER DEFAULT 0,
      FOREIGN KEY (department_id) REFERENCES departments(id),
      FOREIGN KEY (post_id) REFERENCES posts(id)
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      employee_matricule TEXT NOT NULL,
      department_id INTEGER NOT NULL,
      created_by_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days INTEGER NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'pending_manager',
      target_manager_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      manager_approved_at DATETIME,
      ceo_approved_at DATETIME,
      hr_treated_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS admin_document_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      employee_matricule TEXT NOT NULL,
      department_id INTEGER NOT NULL,
      created_by_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT DEFAULT 'pending_manager',
      target_manager_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      manager_approved_at DATETIME,
      hr_treated_at DATETIME
    );
  `);

  // Seed only if empty
  const deptCount = await db.execute("SELECT COUNT(*) as c FROM departments");
  if ((deptCount.rows[0] as any).c === 0) {
    for (const d of ["Informatique", "Marketing", "Finance", "Administratif"]) {
      await db.execute({ sql: "INSERT INTO departments (name) VALUES (?)", args: [d] });
    }
    await db.execute({ sql: "INSERT INTO users (name, email, password, matricule, role, department_id, balance) VALUES (?, ?, ?, ?, ?, ?, ?)", args: ["Firas Chebbi", "firas.chebbi@halung.com", "1991", "1182", "hr", null, 30] });
    await db.execute({ sql: "INSERT INTO users (name, email, password, matricule, role, department_id, balance) VALUES (?, ?, ?, ?, ?, ?, ?)", args: ["Michael Ahalung", "michael@halung.com", "michael123", "CEO-001", "ceo", 4, 30] });
  }
}

async function startServer() {
  await initDB();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

  app.use(cors());
  app.use(express.json());

  // Keep-alive
  setInterval(async () => {
    try { await fetch('https://hr-smart.onrender.com/'); } catch(e) {}
  }, 10 * 60 * 1000);

  // ── AUTH ──
  app.post("/api/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      const result = await db.execute({ sql: `SELECT u.*, d.name as department_name, p.title as post_title FROM users u LEFT JOIN departments d ON u.department_id = d.id LEFT JOIN posts p ON u.post_id = p.id WHERE u.email = ? AND u.password = ?`, args: [email, password] });
      if (!result.rows[0]) return res.status(401).json({ error: "Invalid credentials" });
      res.json(result.rows[0]);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ── USERS ──
  app.get("/api/users", async (req, res) => {
    try {
      const result = await db.execute(`SELECT u.*, d.name as department_name, p.title as post_title FROM users u LEFT JOIN departments d ON u.department_id = d.id LEFT JOIN posts p ON u.post_id = p.id ORDER BY u.name`);
      res.json(result.rows);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const { name, email, password, matricule, role, departmentId, postId, balance, canRequest, directToCeo } = req.body;
      const result = await db.execute({ sql: `INSERT INTO users (name, email, password, matricule, role, department_id, post_id, balance, can_request, direct_to_ceo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [name, email, password, matricule, role, departmentId || null, postId || null, balance ?? 25, canRequest ? 1 : 0, directToCeo ? 1 : 0] });
      const newUser = await db.execute({ sql: `SELECT u.*, d.name as department_name, p.title as post_title FROM users u LEFT JOIN departments d ON u.department_id = d.id LEFT JOIN posts p ON u.post_id = p.id WHERE u.id = ?`, args: [result.lastInsertRowid] });
      io.emit("user_created", newUser.rows[0]);
      res.json(newUser.rows[0]);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.patch("/api/users/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, email, password, matricule, role, departmentId, postId, balance, canRequest, directToCeo } = req.body;
      await db.execute({ sql: `UPDATE users SET name=?, email=?, password=?, matricule=?, role=?, department_id=?, post_id=?, balance=?, can_request=?, direct_to_ceo=? WHERE id=?`, args: [name, email, password, matricule, role, departmentId || null, postId || null, balance, canRequest ? 1 : 0, directToCeo ? 1 : 0, id] });
      const updated = await db.execute({ sql: `SELECT u.*, d.name as department_name, p.title as post_title FROM users u LEFT JOIN departments d ON u.department_id = d.id LEFT JOIN posts p ON u.post_id = p.id WHERE u.id = ?`, args: [id] });
      io.emit("user_updated", updated.rows[0]);
      res.json(updated.rows[0]);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete("/api/users/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [id] });
      io.emit("user_deleted", { id: parseInt(id) });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ── DEPARTMENTS ──
  app.get("/api/departments", async (req, res) => {
    try {
      const result = await db.execute("SELECT * FROM departments ORDER BY name");
      res.json(result.rows);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/departments", async (req, res) => {
    try {
      const { name } = req.body;
      const result = await db.execute({ sql: "INSERT INTO departments (name) VALUES (?)", args: [name] });
      const dept = await db.execute({ sql: "SELECT * FROM departments WHERE id = ?", args: [result.lastInsertRowid] });
      io.emit("department_created", dept.rows[0]);
      res.json(dept.rows[0]);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete("/api/departments/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.execute({ sql: "DELETE FROM departments WHERE id = ?", args: [id] });
      io.emit("department_deleted", { id: parseInt(id) });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ── POSTS ──
  app.get("/api/posts", async (req, res) => {
    try {
      const result = await db.execute(`SELECT p.*, d.name as department_name FROM posts p LEFT JOIN departments d ON p.department_id = d.id ORDER BY p.title`);
      res.json(result.rows);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/posts", async (req, res) => {
    try {
      const { title, departmentId } = req.body;
      const result = await db.execute({ sql: "INSERT INTO posts (title, department_id) VALUES (?, ?)", args: [title, departmentId || null] });
      const post = await db.execute({ sql: `SELECT p.*, d.name as department_name FROM posts p LEFT JOIN departments d ON p.department_id = d.id WHERE p.id = ?`, args: [result.lastInsertRowid] });
      io.emit("post_created", post.rows[0]);
      res.json(post.rows[0]);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete("/api/posts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.execute({ sql: "DELETE FROM posts WHERE id = ?", args: [id] });
      io.emit("post_deleted", { id: parseInt(id) });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ── LEAVE REQUESTS ──
  app.get("/api/leave-requests", async (req, res) => {
    try {
      const { role, departmentId, userId } = req.query;
      let result;
      if (role === 'hr' || role === 'ceo') {
        result = await db.execute(`SELECT lr.*, cb.name as creator_name, d.name as department_name FROM leave_requests lr JOIN users cb ON lr.created_by_id = cb.id LEFT JOIN departments d ON lr.department_id = d.id ORDER BY lr.created_at DESC`);
      } else {
        result = await db.execute({ sql: `SELECT lr.*, cb.name as creator_name, d.name as department_name FROM leave_requests lr JOIN users cb ON lr.created_by_id = cb.id LEFT JOIN departments d ON lr.department_id = d.id WHERE lr.created_by_id = ? OR lr.target_manager_id = ? OR (lr.target_manager_id IS NULL AND lr.department_id = ?) ORDER BY lr.created_at DESC`, args: [userId, userId, departmentId] });
      }
      res.json(result.rows);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/leave-requests", async (req, res) => {
    try {
      const { employeeName, employeeMatricule, departmentId, creatorId, type, startDate, endDate, days, reason, targetManagerId, directToCeo } = req.body;
      const creator = await db.execute({ sql: "SELECT role, direct_to_ceo FROM users WHERE id = ?", args: [creatorId] });
      const creatorData = creator.rows[0] as any;
      
      let initialStatus = 'pending_manager';
      if (directToCeo === 1 || directToCeo === true || creatorData.direct_to_ceo === 1) {
        initialStatus = 'pending_ceo';
      } else if (creatorData.role === 'manager') {
        initialStatus = 'pending_hr';
      }

      const result = await db.execute({ sql: `INSERT INTO leave_requests (employee_name, employee_matricule, department_id, created_by_id, type, start_date, end_date, days, reason, status, target_manager_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`, args: [employeeName, employeeMatricule, departmentId, creatorId, type, startDate, endDate, days, reason, initialStatus, targetManagerId || null] });
      const newRequest = await db.execute({ sql: `SELECT lr.*, cb.name as creator_name, d.name as department_name FROM leave_requests lr JOIN users cb ON lr.created_by_id = cb.id LEFT JOIN departments d ON lr.department_id = d.id WHERE lr.id = ?`, args: [result.lastInsertRowid] });
      io.emit("leave_request_created", newRequest.rows[0]);
      res.json(newRequest.rows[0]);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.patch("/api/leave-requests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { action, role } = req.body;
      const reqData = await db.execute({ sql: "SELECT * FROM leave_requests WHERE id = ?", args: [id] });
      const request = reqData.rows[0] as any;
      if (!request) return res.status(404).json({ error: "Not found" });

      let newStatus = request.status;
      let manager_approved_at = request.manager_approved_at;
      let ceo_approved_at = request.ceo_approved_at;
      let hr_treated_at = request.hr_treated_at;

      if (action === 'reject') {
        newStatus = 'rejected';
      } else if (action === 'approve') {
        if ((role === 'manager' || role === 'superior') && request.status === 'pending_manager') {
          newStatus = 'pending_hr'; manager_approved_at = new Date().toISOString();
        } else if (role === 'ceo' && request.status === 'pending_ceo') {
          newStatus = 'pending_hr'; ceo_approved_at = new Date().toISOString();
        } else if (role === 'hr' && request.status === 'pending_hr') {
          newStatus = 'approved'; hr_treated_at = new Date().toISOString();
          await db.execute({ sql: "UPDATE users SET balance = balance - ? WHERE matricule = ?", args: [request.days, request.employee_matricule] });
        }
      }

      await db.execute({ sql: `UPDATE leave_requests SET status=?, manager_approved_at=?, ceo_approved_at=?, hr_treated_at=? WHERE id=?`, args: [newStatus, manager_approved_at, ceo_approved_at, hr_treated_at, id] });
      const updated = await db.execute({ sql: `SELECT lr.*, cb.name as creator_name, d.name as department_name FROM leave_requests lr JOIN users cb ON lr.created_by_id = cb.id LEFT JOIN departments d ON lr.department_id = d.id WHERE lr.id = ?`, args: [id] });
      io.emit("leave_request_updated", updated.rows[0]);
      res.json(updated.rows[0]);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete("/api/leave-requests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.execute({ sql: "DELETE FROM leave_requests WHERE id = ?", args: [id] });
      io.emit("leave_request_deleted", { id: parseInt(id) });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ── DOCUMENT REQUESTS ──
  app.get("/api/document-requests", async (req, res) => {
    try {
      const { role, departmentId, userId } = req.query;
      let result;
      if (role === 'hr' || role === 'ceo') {
        result = await db.execute(`SELECT dr.*, cb.name as creator_name, d.name as department_name FROM admin_document_requests dr JOIN users cb ON dr.created_by_id = cb.id LEFT JOIN departments d ON dr.department_id = d.id ORDER BY dr.created_at DESC`);
      } else {
        result = await db.execute({ sql: `SELECT dr.*, cb.name as creator_name, d.name as department_name FROM admin_document_requests dr JOIN users cb ON dr.created_by_id = cb.id LEFT JOIN departments d ON dr.department_id = d.id WHERE dr.created_by_id = ? OR dr.target_manager_id = ? OR (dr.target_manager_id IS NULL AND dr.department_id = ?) ORDER BY dr.created_at DESC`, args: [userId, userId, departmentId] });
      }
      res.json(result.rows);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post("/api/document-requests", async (req, res) => {
    try {
      const { employeeName, employeeMatricule, departmentId, creatorId, type, purpose, targetManagerId } = req.body;
      const creator = await db.execute({ sql: "SELECT role FROM users WHERE id = ?", args: [creatorId] });
      const creatorData = creator.rows[0] as any;
      const initialStatus = creatorData.role === 'manager' ? 'pending_hr' : 'pending_manager';
      const result = await db.execute({ sql: `INSERT INTO admin_document_requests (employee_name, employee_matricule, department_id, created_by_id, type, purpose, status, target_manager_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`, args: [employeeName, employeeMatricule, departmentId, creatorId, type, purpose, initialStatus, targetManagerId || null] });
      const newReq = await db.execute({ sql: `SELECT dr.*, cb.name as creator_name, d.name as department_name FROM admin_document_requests dr JOIN users cb ON dr.created_by_id = cb.id LEFT JOIN departments d ON dr.department_id = d.id WHERE dr.id = ?`, args: [result.lastInsertRowid] });
      io.emit("document_request_created", newReq.rows[0]);
      res.json(newReq.rows[0]);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.patch("/api/document-requests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { action, role } = req.body;
      const reqData = await db.execute({ sql: "SELECT * FROM admin_document_requests WHERE id = ?", args: [id] });
      const request = reqData.rows[0] as any;
      if (!request) return res.status(404).json({ error: "Not found" });

      let newStatus = request.status;
      let manager_approved_at = request.manager_approved_at;
      let hr_treated_at = request.hr_treated_at;

      if (action === 'reject') {
        newStatus = 'rejected';
      } else if (action === 'approve') {
        if ((role === 'manager' || role === 'superior') && request.status === 'pending_manager') {
          newStatus = 'pending_hr'; manager_approved_at = new Date().toISOString();
        } else if (role === 'hr' && request.status === 'pending_hr') {
          newStatus = 'treated'; hr_treated_at = new Date().toISOString();
        }
      }

      await db.execute({ sql: `UPDATE admin_document_requests SET status=?, manager_approved_at=?, hr_treated_at=? WHERE id=?`, args: [newStatus, manager_approved_at, hr_treated_at, id] });
      const updated = await db.execute({ sql: `SELECT dr.*, cb.name as creator_name, d.name as department_name FROM admin_document_requests dr JOIN users cb ON dr.created_by_id = cb.id LEFT JOIN departments d ON dr.department_id = d.id WHERE dr.id = ?`, args: [id] });
      io.emit("document_request_updated", updated.rows[0]);
      res.json(updated.rows[0]);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete("/api/document-requests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.execute({ sql: "DELETE FROM admin_document_requests WHERE id = ?", args: [id] });
      io.emit("document_request_deleted", { id: parseInt(id) });
      res.json({ success: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ── STATS ──
  app.get("/api/stats/departments", async (req, res) => {
    try {
      const result = await db.execute(`SELECT d.name as department_name, COUNT(CASE WHEN lr.status = 'pending_manager' THEN 1 END) as pending_manager, COUNT(CASE WHEN lr.status = 'pending_ceo' THEN 1 END) as pending_ceo, COUNT(CASE WHEN lr.status = 'pending_hr' THEN 1 END) as pending_hr, COUNT(CASE WHEN lr.status = 'approved' THEN 1 END) as approved FROM departments d LEFT JOIN leave_requests lr ON lr.department_id = d.id GROUP BY d.id`);
      res.json(result.rows);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get("/api/stats/documents", async (req, res) => {
    try {
      const typeStats = await db.execute("SELECT type, COUNT(*) as count FROM admin_document_requests GROUP BY type");
      const deptStats = await db.execute(`SELECT d.name as department_name, COUNT(dr.id) as count FROM departments d LEFT JOIN admin_document_requests dr ON dr.department_id = d.id GROUP BY d.id`);
      const userStats = await db.execute(`SELECT employee_name, COUNT(*) as count FROM admin_document_requests GROUP BY employee_matricule ORDER BY count DESC LIMIT 5`);
      res.json({ typeStats: typeStats.rows, deptStats: deptStats.rows, userStats: userStats.rows });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // ── STATIC ──
  const distPath = path.join(__dirname, "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  const PORT = parseInt(process.env.PORT || "3000");
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Smart-HR server running on http://localhost:${PORT}`);
  });
}

startServer();
