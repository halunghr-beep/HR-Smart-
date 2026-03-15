import express from "express";
import { Server } from "socket.io";
import http from "http";
import Database from "better-sqlite3";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import cron from "node-cron";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path — in Electron packaged app, store DB next to executable
const dbPath = process.env.DB_PATH || path.join(__dirname, "rh_conges.db");
const db = new Database(dbPath);

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
  if (!process.env.SMTP_HOST) {
    console.log("SMTP not configured. Skipping email to:", to);
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
    });
    console.log("Email sent to:", to);
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}

async function checkPendingReminders() {
  try {
    const pendingRequests = db.prepare(`
      SELECT lr.*, d.name as department_name
      FROM leave_requests lr
      LEFT JOIN departments d ON lr.department_id = d.id
      WHERE (lr.status = 'pending_manager' OR lr.status = 'pending_hr')
      AND datetime(lr.created_at) <= datetime('now', '-48 hours')
    `).all() as any[];

    for (const req of pendingRequests) {
      if (req.status === 'pending_manager') {
        const managers = db.prepare("SELECT email FROM users WHERE (role = 'manager' OR role = 'superior') AND department_id = ?").all(req.department_id) as any[];
        for (const manager of managers) {
          await sendEmail(manager.email, `REMINDER: Pending leave request - ${req.employee_name}`, `
            <h2>Pending Request Reminder</h2>
            <p>The leave request for <strong>${req.employee_name}</strong> has been pending for over 48 hours.</p>
            <p><strong>Period:</strong> ${req.start_date} to ${req.end_date} (${req.days} days)</p>
          `);
        }
      } else if (req.status === 'pending_hr') {
        const hrUsers = db.prepare("SELECT email FROM users WHERE role = 'hr'").all() as any[];
        for (const hr of hrUsers) {
          await sendEmail(hr.email, `HR REMINDER: Pending leave request - ${req.employee_name}`, `
            <h2>Pending Request Reminder (HR)</h2>
            <p>The request for <strong>${req.employee_name}</strong> has been pending HR treatment for over 48 hours.</p>
          `);
        }
      }
    }
  } catch (error) {
    console.error("Error in checkPendingReminders:", error);
  }
}

cron.schedule('0 * * * *', checkPendingReminders);

// Initialize DB schema (safe — uses IF NOT EXISTS)
db.exec(`
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
    hr_treated_at DATETIME,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (created_by_id) REFERENCES users(id)
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
    hr_treated_at DATETIME,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (created_by_id) REFERENCES users(id)
  );
`);

// Seed only if no departments exist
const deptCount = (db.prepare("SELECT COUNT(*) as c FROM departments").get() as any).c;
if (deptCount === 0) {
  const depts = ["Informatique", "Marketing", "Finance", "Administratif"];
  depts.forEach(d => db.prepare("INSERT INTO departments (name) VALUES (?)").run(d));

  db.prepare("INSERT INTO users (name, email, password, matricule, role, department_id, balance) VALUES (?, ?, ?, ?, ?, ?, ?)").run("Firas Chebbi", "firas.chebbi@halung.com", "1991", "1182", "hr", null, 30);
  db.prepare("INSERT INTO users (name, email, password, matricule, role, department_id, balance) VALUES (?, ?, ?, ?, ?, ?, ?)").run("Michael Ahalung", "michael@halung.com", "michael123", "CEO-001", "ceo", 4, 30);
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  app.use(cors());
  app.use(express.json());

  // ─── API Routes ────────────────────────────────────────────────────────────

  app.post("/api/login", (req, res) => {
    try {
      const { email, password } = req.body;
      const user = db.prepare(`
        SELECT u.*, d.name as department_name, p.title as post_title
        FROM users u 
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN posts p ON u.post_id = p.id
        WHERE u.email = ? AND u.password = ?
      `).get(email, password) as any;
      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/users", (req, res) => {
    try {
      const users = db.prepare(`
        SELECT u.*, d.name as department_name, p.title as post_title
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN posts p ON u.post_id = p.id
        ORDER BY u.name
      `).all();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/users", (req, res) => {
    try {
      const { name, email, password, matricule, role, departmentId, postId, balance, canRequest, directToCeo } = req.body;
      const result = db.prepare(`
        INSERT INTO users (name, email, password, matricule, role, department_id, post_id, balance, can_request, direct_to_ceo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, email, password, matricule, role, departmentId || null, postId || null, balance ?? 25, canRequest ?? 1, directToCeo ?? 0);
      const newUser = db.prepare(`
        SELECT u.*, d.name as department_name, p.title as post_title
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN posts p ON u.post_id = p.id
        WHERE u.id = ?
      `).get(result.lastInsertRowid);
      io.emit("user_created", newUser);
      res.json(newUser);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/users/:id", (req, res) => {
    try {
      const { id } = req.params;
      const { name, email, password, matricule, role, departmentId, postId, balance, canRequest, directToCeo } = req.body;
      db.prepare(`
        UPDATE users SET name=?, email=?, password=?, matricule=?, role=?, department_id=?, post_id=?, balance=?, can_request=?, direct_to_ceo=?
        WHERE id=?
      `).run(name, email, password, matricule, role, departmentId || null, postId || null, balance, canRequest, directToCeo, id);
      const updated = db.prepare(`
        SELECT u.*, d.name as department_name, p.title as post_title
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN posts p ON u.post_id = p.id
        WHERE u.id = ?
      `).get(id);
      io.emit("user_updated", updated);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/users/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
      io.emit("user_deleted", { id: parseInt(id) });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/departments", (req, res) => {
    try {
      const departments = db.prepare("SELECT * FROM departments ORDER BY name").all();
      res.json(departments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/departments", (req, res) => {
    try {
      const { name } = req.body;
      const result = db.prepare("INSERT INTO departments (name) VALUES (?)").run(name);
      const dept = db.prepare("SELECT * FROM departments WHERE id = ?").get(result.lastInsertRowid);
      io.emit("department_created", dept);
      res.json(dept);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/departments/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM departments WHERE id = ?").run(id);
      io.emit("department_deleted", { id: parseInt(id) });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/posts", (req, res) => {
    try {
      const posts = db.prepare(`
        SELECT p.*, d.name as department_name FROM posts p
        LEFT JOIN departments d ON p.department_id = d.id
        ORDER BY p.title
      `).all();
      res.json(posts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/posts", (req, res) => {
    try {
      const { title, departmentId } = req.body;
      const result = db.prepare("INSERT INTO posts (title, department_id) VALUES (?, ?)").run(title, departmentId || null);
      const post = db.prepare(`
        SELECT p.*, d.name as department_name FROM posts p
        LEFT JOIN departments d ON p.department_id = d.id
        WHERE p.id = ?
      `).get(result.lastInsertRowid);
      io.emit("post_created", post);
      res.json(post);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/posts/:id", (req, res) => {
    try {
      const { id } = req.params;
      db.prepare("DELETE FROM posts WHERE id = ?").run(id);
      io.emit("post_deleted", { id: parseInt(id) });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/leave-requests", (req, res) => {
    try {
      const { role, departmentId, userId } = req.query;
      let requests;
      if (role === 'hr' || role === 'ceo') {
        requests = db.prepare(`
          SELECT lr.*, cb.name as creator_name, d.name as department_name
          FROM leave_requests lr 
          JOIN users cb ON lr.created_by_id = cb.id
          LEFT JOIN departments d ON lr.department_id = d.id
          ORDER BY lr.created_at DESC
        `).all();
      } else {
        requests = db.prepare(`
          SELECT lr.*, cb.name as creator_name, d.name as department_name
          FROM leave_requests lr 
          JOIN users cb ON lr.created_by_id = cb.id
          LEFT JOIN departments d ON lr.department_id = d.id
          WHERE lr.created_by_id = ? OR lr.target_manager_id = ? OR (lr.target_manager_id IS NULL AND lr.department_id = ?)
          ORDER BY lr.created_at DESC
        `).all(userId, userId, departmentId);
      }
      res.json(requests);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/leave-requests", async (req, res) => {
    try {
      const { employeeName, employeeMatricule, departmentId, creatorId, type, startDate, endDate, days, reason, targetManagerId } = req.body;
      
      const creator = db.prepare("SELECT role, department_id, direct_to_ceo FROM users WHERE id = ?").get(creatorId) as any;
      let initialStatus = creator.direct_to_ceo === 1 ? 'pending_ceo' : 'pending_manager';

      const result = db.prepare(`
        INSERT INTO leave_requests (employee_name, employee_matricule, department_id, created_by_id, type, start_date, end_date, days, reason, status, target_manager_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(employeeName, employeeMatricule, departmentId, creatorId, type, startDate, endDate, days, reason, initialStatus, targetManagerId || null);
      
      const newRequest = db.prepare(`
        SELECT lr.*, cb.name as creator_name, d.name as department_name
        FROM leave_requests lr 
        JOIN users cb ON lr.created_by_id = cb.id
        LEFT JOIN departments d ON lr.department_id = d.id
        WHERE lr.id = ?
      `).get(result.lastInsertRowid) as any;
      
      io.emit("leave_request_created", newRequest);

      const managers = db.prepare("SELECT email FROM users WHERE (role='manager' OR role='superior') AND department_id = ?").all(departmentId) as any[];
      const subject = `New leave request: ${employeeName}`;
      const html = `<h2>New Leave Request</h2><p><strong>${employeeName}</strong> has submitted a leave request from ${startDate} to ${endDate} (${days} days).</p>`;
      managers.forEach(m => sendEmail(m.email, subject, html));

      res.json(newRequest);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/leave-requests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { action, role } = req.body;
      
      const request = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id) as any;
      if (!request) return res.status(404).json({ error: "Request not found" });

      let newStatus = request.status;
      let manager_approved_at = request.manager_approved_at;
      let ceo_approved_at = request.ceo_approved_at;
      let hr_treated_at = request.hr_treated_at;

      if (action === 'reject') {
        newStatus = 'rejected';
      } else if (action === 'approve') {
        if ((role === 'manager' || role === 'superior') && request.status === 'pending_manager') {
          newStatus = 'pending_hr';
          manager_approved_at = new Date().toISOString();
        } else if (role === 'ceo' && request.status === 'pending_ceo') {
          newStatus = 'pending_hr';
          ceo_approved_at = new Date().toISOString();
        } else if (role === 'hr' && request.status === 'pending_hr') {
          newStatus = 'approved';
          hr_treated_at = new Date().toISOString();
          // Deduct from balance
          db.prepare("UPDATE users SET balance = balance - ? WHERE matricule = ?").run(request.days, request.employee_matricule);
        }
      }

      db.prepare(`
        UPDATE leave_requests SET status=?, manager_approved_at=?, ceo_approved_at=?, hr_treated_at=? WHERE id=?
      `).run(newStatus, manager_approved_at, ceo_approved_at, hr_treated_at, id);

      const updatedRequest = db.prepare(`
        SELECT lr.*, cb.name as creator_name, d.name as department_name
        FROM leave_requests lr 
        JOIN users cb ON lr.created_by_id = cb.id
        LEFT JOIN departments d ON lr.department_id = d.id
        WHERE lr.id = ?
      `).get(id) as any;

      io.emit("leave_request_updated", updatedRequest);

      // Notify creator
      const creator = db.prepare("SELECT email FROM users WHERE id = ?").get(request.created_by_id) as any;
      if (creator) {
        const statusLabels: Record<string, string> = { approved: 'Approved', rejected: 'Rejected', pending_hr: 'Validated by Manager', pending_ceo: 'Pending CEO' };
        sendEmail(creator.email, `Update on leave request: ${statusLabels[newStatus] || newStatus}`, `
          <h2>Leave Request Update</h2>
          <p>Your request from ${request.start_date} to ${request.end_date} is now: <strong>${statusLabels[newStatus] || newStatus}</strong></p>
        `);
      }

      res.json(updatedRequest);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/document-requests", (req, res) => {
    try {
      const { role, departmentId, userId } = req.query;
      let requests;
      if (role === 'hr' || role === 'ceo') {
        requests = db.prepare(`
          SELECT dr.*, cb.name as creator_name, d.name as department_name
          FROM admin_document_requests dr 
          JOIN users cb ON dr.created_by_id = cb.id
          LEFT JOIN departments d ON dr.department_id = d.id
          ORDER BY dr.created_at DESC
        `).all();
      } else {
        requests = db.prepare(`
          SELECT dr.*, cb.name as creator_name, d.name as department_name
          FROM admin_document_requests dr 
          JOIN users cb ON dr.created_by_id = cb.id
          LEFT JOIN departments d ON dr.department_id = d.id
          WHERE dr.created_by_id = ? OR dr.target_manager_id = ? OR (dr.target_manager_id IS NULL AND dr.department_id = ?)
          ORDER BY dr.created_at DESC
        `).all(userId, userId, departmentId);
      }
      res.json(requests);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/document-requests", async (req, res) => {
    try {
      const { employeeName, employeeMatricule, departmentId, creatorId, type, purpose, targetManagerId } = req.body;
      const creator = db.prepare("SELECT role FROM users WHERE id = ?").get(creatorId) as any;
      let initialStatus = creator.role === 'manager' ? 'pending_hr' : 'pending_manager';
      
      const result = db.prepare(`
        INSERT INTO admin_document_requests (employee_name, employee_matricule, department_id, created_by_id, type, purpose, status, target_manager_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(employeeName, employeeMatricule, departmentId, creatorId, type, purpose, initialStatus, targetManagerId || null);
      
      const newRequest = db.prepare(`
        SELECT dr.*, cb.name as creator_name, d.name as department_name
        FROM admin_document_requests dr 
        JOIN users cb ON dr.created_by_id = cb.id
        LEFT JOIN departments d ON dr.department_id = d.id
        WHERE dr.id = ?
      `).get(result.lastInsertRowid);
      
      io.emit("document_request_created", newRequest);
      res.json(newRequest);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/document-requests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { action, role } = req.body;
      const request = db.prepare("SELECT * FROM admin_document_requests WHERE id = ?").get(id) as any;
      if (!request) return res.status(404).json({ error: "Not found" });

      let newStatus = request.status;
      let manager_approved_at = request.manager_approved_at;
      let hr_treated_at = request.hr_treated_at;

      if (action === 'reject') {
        newStatus = 'rejected';
      } else if (action === 'approve') {
        if ((role === 'manager' || role === 'superior') && request.status === 'pending_manager') {
          newStatus = 'pending_hr';
          manager_approved_at = new Date().toISOString();
        } else if (role === 'hr' && request.status === 'pending_hr') {
          newStatus = 'treated';
          hr_treated_at = new Date().toISOString();
        }
      }

      db.prepare("UPDATE admin_document_requests SET status=?, manager_approved_at=?, hr_treated_at=? WHERE id=?")
        .run(newStatus, manager_approved_at, hr_treated_at, id);

      const updated = db.prepare(`
        SELECT dr.*, cb.name as creator_name, d.name as department_name
        FROM admin_document_requests dr 
        JOIN users cb ON dr.created_by_id = cb.id
        LEFT JOIN departments d ON dr.department_id = d.id
        WHERE dr.id = ?
      `).get(id);
      
      io.emit("document_request_updated", updated);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stats/departments", (req, res) => {
    try {
      const stats = db.prepare(`
        SELECT d.name as department_name,
          COUNT(CASE WHEN lr.status = 'pending_manager' THEN 1 END) as pending_manager,
          COUNT(CASE WHEN lr.status = 'pending_ceo' THEN 1 END) as pending_ceo,
          COUNT(CASE WHEN lr.status = 'pending_hr' THEN 1 END) as pending_hr,
          COUNT(CASE WHEN lr.status = 'approved' THEN 1 END) as approved
        FROM departments d
        LEFT JOIN leave_requests lr ON lr.department_id = d.id
        GROUP BY d.id
      `).all();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stats/documents", (req, res) => {
    try {
      const typeStats = db.prepare("SELECT type, COUNT(*) as count FROM admin_document_requests GROUP BY type").all();
      const deptStats = db.prepare(`
        SELECT d.name as department_name, COUNT(dr.id) as count
        FROM departments d
        LEFT JOIN admin_document_requests dr ON dr.department_id = d.id
        GROUP BY d.id
      `).all();
      const userStats = db.prepare(`
        SELECT employee_name, COUNT(*) as count
        FROM admin_document_requests
        GROUP BY employee_matricule
        ORDER BY count DESC LIMIT 5
      `).all();
      res.json({ typeStats, deptStats, userStats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ─── Static file serving (production / Electron) ───────────────────────────
  const distPath = process.env.DIST_PATH || path.join(__dirname, "dist");
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
