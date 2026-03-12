import express from "express";
import { createServer as createViteServer } from "vite";
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

const db = new Database("rh_conges.db");

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.SMTP_HOST) {
    console.log("SMTP not configured. Skipping email to:", to);
    console.log("Subject:", subject);
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
    console.error("Failed to send email to:", to, error);
  }
}

// Reminder logic
async function checkPendingReminders() {
  console.log("Running pending reminders check...");
  try {
    // Find requests pending for more than 48 hours
    const pendingRequests = db.prepare(`
      SELECT lr.*, d.name as department_name
      FROM leave_requests lr
      LEFT JOIN departments d ON lr.department_id = d.id
      WHERE (lr.status = 'pending_manager' OR lr.status = 'pending_hr')
      AND datetime(lr.created_at) <= datetime('now', '-48 hours')
    `).all() as any[];

    for (const req of pendingRequests) {
      if (req.status === 'pending_manager') {
        // Find managers/superiors for this department
        const managers = db.prepare("SELECT email FROM users WHERE (role = 'manager' OR role = 'superior') AND department_id = ?").all(req.department_id) as any[];
        for (const manager of managers) {
          await sendEmail(
            manager.email,
            `REMINDER: Pending leave request - ${req.employee_name}`,
            `
              <h2>Pending Request Reminder</h2>
              <p>The leave request for <strong>${req.employee_name}</strong> has been pending your validation for over 48 hours.</p>
              <p><strong>Period:</strong> from ${req.start_date} to ${req.end_date} (${req.days} days)</p>
              <p>Please log in to the portal to process this request.</p>
            `
          );
        }
      } else if (req.status === 'pending_hr') {
        // Find all HR users
        const hrUsers = db.prepare("SELECT email FROM users WHERE role = 'hr'").all() as any[];
        for (const hr of hrUsers) {
          await sendEmail(
            hr.email,
            `HR REMINDER: Pending leave request - ${req.employee_name}`,
            `
              <h2>Pending Request Reminder (HR)</h2>
              <p>The leave request for <strong>${req.employee_name}</strong> has been validated by their manager but has been pending your final processing for over 48 hours.</p>
              <p><strong>Department:</strong> ${req.department_name}</p>
              <p><strong>Period:</strong> from ${req.start_date} to ${req.end_date} (${req.days} days)</p>
              <p>Please finalize the processing of this request.</p>
            `
          );
        }
      }
    }
  } catch (error) {
    console.error("Error in checkPendingReminders:", error);
  }
}

// Schedule reminders check every hour
cron.schedule('0 * * * *', checkPendingReminders);

// Force schema reset for development to ensure all columns exist
db.exec(`
  DROP TABLE IF EXISTS leave_requests;
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS departments;
  DROP TABLE IF EXISTS posts;

  CREATE TABLE departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT UNIQUE NOT NULL,
    department_id INTEGER,
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    matricule TEXT UNIQUE,
    role TEXT DEFAULT 'superior', -- 'superior', 'manager', 'hr', 'ceo'
    department_id INTEGER,
    post_id INTEGER,
    balance INTEGER DEFAULT 25,
    can_request INTEGER DEFAULT 1, -- 1 for true, 0 for false
    direct_to_ceo INTEGER DEFAULT 0, -- 1 for true, 0 for false
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );

  CREATE TABLE leave_requests (
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
    status TEXT DEFAULT 'pending_manager', -- 'pending_manager', 'pending_ceo', 'pending_hr', 'approved', 'rejected'
    target_manager_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    manager_approved_at DATETIME,
    ceo_approved_at DATETIME,
    hr_treated_at DATETIME,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (created_by_id) REFERENCES users(id)
  );

  CREATE TABLE admin_document_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    employee_matricule TEXT NOT NULL,
    department_id INTEGER NOT NULL,
    created_by_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- 'work_attestation', 'salary_attestation', 'tax_certificate'
    purpose TEXT NOT NULL, -- 'CIN', 'bank_credit'
    status TEXT DEFAULT 'pending_manager', -- 'pending_manager', 'pending_hr', 'treated', 'rejected'
    target_manager_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    manager_approved_at DATETIME,
    hr_treated_at DATETIME,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (created_by_id) REFERENCES users(id)
  );
`);

// Seed initial data
const depts = ["Informatique", "Marketing", "Finance", "Administratif"];
depts.forEach(d => db.prepare("INSERT INTO departments (name) VALUES (?)").run(d));

// IT Dept
db.prepare("INSERT INTO users (name, email, password, matricule, role, department_id, balance) VALUES (?, ?, ?, ?, ?, ?, ?)").run("Sami Superior", "sami@it.com", "sami123", "2024-001", "superior", 1, 25);
db.prepare("INSERT INTO users (name, email, password, matricule, role, department_id, balance) VALUES (?, ?, ?, ?, ?, ?, ?)").run("Karim Manager", "karim@it.com", "karim123", "2024-002", "manager", 1, 25);

// Marketing Dept
db.prepare("INSERT INTO users (name, email, password, matricule, role, department_id, balance) VALUES (?, ?, ?, ?, ?, ?, ?)").run("Leila Superior", "leila@mkt.com", "leila123", "2024-003", "superior", 2, 25);

// HR (Global)
db.prepare("INSERT INTO users (name, email, password, matricule, role, department_id, balance) VALUES (?, ?, ?, ?, ?, ?, ?)").run("Marie RH", "marie@rh.com", "marie123", "2024-004", "hr", null, 30);

// CEO
db.prepare("INSERT INTO users (name, email, password, matricule, role, department_id, balance) VALUES (?, ?, ?, ?, ?, ?, ?)").run("Michael Ahalung", "michael@halung.com", "michael123", "CEO-001", "ceo", 4, 30);

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  app.use(cors());
  app.use(express.json());

  // API Routes with basic error handling
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

      if (user) {
        // Don't send password back
        const { password: _, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
      } else {
        res.status(401).json({ error: "Identifiants invalides" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/users", (req, res) => {
    try {
      const { name, email, password, matricule, role, departmentId, postId, canRequest, directToCeo } = req.body;
      
      // Check if email already exists
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (existing) {
        return res.status(400).json({ error: "This email is already used" });
      }

      const result = db.prepare(`
        INSERT INTO users (name, email, password, matricule, role, department_id, post_id, can_request, direct_to_ceo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, email, password, matricule || null, role, departmentId || null, postId || null, canRequest ? 1 : 0, directToCeo ? 1 : 0);
      
      const newUser = db.prepare(`
        SELECT u.*, d.name as department_name, p.title as post_title
        FROM users u 
        LEFT JOIN departments d ON u.department_id = d.id
        LEFT JOIN posts p ON u.post_id = p.id
        WHERE u.id = ?
      `).get(result.lastInsertRowid) as any;
      
      const { password: _, ...userWithoutPassword } = newUser;
      res.json(userWithoutPassword);
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
      `).all();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/departments", (req, res) => {
    try {
      const depts = db.prepare("SELECT * FROM departments").all();
      res.json(depts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/departments", (req, res) => {
    try {
      const { name } = req.body;
      const result = db.prepare("INSERT INTO departments (name) VALUES (?)").run(name);
      const newDept = db.prepare("SELECT * FROM departments WHERE id = ?").get(result.lastInsertRowid);
      res.json(newDept);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/posts", (req, res) => {
    try {
      const posts = db.prepare(`
        SELECT p.*, d.name as department_name 
        FROM posts p 
        LEFT JOIN departments d ON p.department_id = d.id
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
      const newPost = db.prepare(`
        SELECT p.*, d.name as department_name 
        FROM posts p 
        LEFT JOIN departments d ON p.department_id = d.id
        WHERE p.id = ?
      `).get(result.lastInsertRowid);
      res.json(newPost);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/requests", (req, res) => {
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

  app.post("/api/requests", async (req, res) => {
    try {
      const { employeeName, employeeMatricule, departmentId, creatorId, type, startDate, endDate, days, reason, targetManagerId } = req.body;
      
      // Determine initial status
      const creator = db.prepare("SELECT role, department_id, can_request, direct_to_ceo FROM users WHERE id = ?").get(creatorId) as any;
      
      if (creator && creator.can_request === 0) {
        return res.status(403).json({ error: "You do not have the right to submit leave requests" });
      }

      let initialStatus = 'pending_manager';
      
      // Workflow logic:
      // 1. If direct_to_ceo is set OR if the user is a manager, it goes to CEO (Michael)
      if (creator.direct_to_ceo === 1 || creator.role === 'manager') {
        initialStatus = 'pending_ceo';
      }

      const result = db.prepare(`
        INSERT INTO leave_requests (
          employee_name, employee_matricule, department_id, created_by_id, 
          type, start_date, end_date, days, reason, status, target_manager_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        employeeName, employeeMatricule, departmentId, creatorId, 
        type, startDate, endDate, days, reason, initialStatus, targetManagerId || null
      );
      
      const newRequest = db.prepare(`
        SELECT lr.*, cb.name as creator_name, cb.email as creator_email, d.name as department_name
        FROM leave_requests lr 
        JOIN users cb ON lr.created_by_id = cb.id
        LEFT JOIN departments d ON lr.department_id = d.id
        WHERE lr.id = ?
      `).get(result.lastInsertRowid) as any;
      
      io.emit("request_created", newRequest);

      // Email notifications
      const hrUsers = db.prepare("SELECT email FROM users WHERE role = 'hr'").all() as any[];
      const employeeUser = db.prepare("SELECT email FROM users WHERE matricule = ?").get(employeeMatricule) as any;

      const subject = `New leave request: ${employeeName}`;
      const html = `
        <h2>New leave request</h2>
        <p><strong>Employee:</strong> ${employeeName} (${employeeMatricule})</p>
        <p><strong>Type:</strong> ${type}</p>
        <p><strong>Period:</strong> from ${startDate} to ${endDate} (${days} days)</p>
        <p><strong>Reason:</strong> ${reason || 'Not specified'}</p>
        <p>The request is pending validation.</p>
      `;

      // Notify HR
      hrUsers.forEach(hr => sendEmail(hr.email, subject, html));
      
      // Notify Approver
      if (initialStatus === 'pending_manager' && targetManagerId) {
        const manager = db.prepare("SELECT email FROM users WHERE id = ?").get(targetManagerId) as any;
        if (manager) sendEmail(manager.email, subject, html);
      } else if (initialStatus === 'pending_ceo') {
        const ceo = db.prepare("SELECT email FROM users WHERE role = 'ceo'").get() as any;
        if (ceo) sendEmail(ceo.email, subject, html);
      }

      // Notify Employee if they exist in system
      if (employeeUser) {
        sendEmail(employeeUser.email, `Confirmation of your leave request`, html);
      } else if (newRequest.creator_email) {
        sendEmail(newRequest.creator_email, `Confirmation of created leave request`, html);
      }

      res.json(newRequest);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/requests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { action, role, userId } = req.body;
      
      const request = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id) as any;
      if (!request) return res.status(404).json({ error: "Request not found" });

      let newStatus = request.status;
      let manager_approved_at = request.manager_approved_at;
      let ceo_approved_at = request.ceo_approved_at;
      let hr_treated_at = request.hr_treated_at;

      if (action === 'reject') {
        newStatus = 'rejected';
      } else if (action === 'approve') {
        // Manager/Superior approval: either the target manager OR any manager in the department (fallback)
        if ((role === 'manager' || role === 'superior') && request.status === 'pending_manager') {
          if (!request.target_manager_id || request.target_manager_id === userId) {
            newStatus = 'pending_hr';
            manager_approved_at = new Date().toISOString();
          }
        } else if (role === 'ceo' && request.status === 'pending_ceo') {
          newStatus = 'pending_hr';
          ceo_approved_at = new Date().toISOString();
        } else if (role === 'hr' && request.status === 'pending_hr') {
          newStatus = 'approved';
          hr_treated_at = new Date().toISOString();
          
          // Deduct from balance if approved
          const employee = db.prepare("SELECT id, balance FROM users WHERE matricule = ?").get(request.employee_matricule) as any;
          if (employee) {
            db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(request.days, employee.id);
          }
        }
      }

      db.prepare(`
        UPDATE leave_requests 
        SET status = ?, manager_approved_at = ?, ceo_approved_at = ?, hr_treated_at = ? 
        WHERE id = ?
      `).run(newStatus, manager_approved_at, ceo_approved_at, hr_treated_at, id);

      const updatedRequest = db.prepare(`
        SELECT lr.*, cb.name as creator_name, cb.email as creator_email, d.name as department_name
        FROM leave_requests lr 
        JOIN users cb ON lr.created_by_id = cb.id
        LEFT JOIN departments d ON lr.department_id = d.id
        WHERE lr.id = ?
      `).get(id) as any;
      
      io.emit("request_updated", { request: updatedRequest });

      // Notify Employee of status change
      const employeeUser = db.prepare("SELECT email FROM users WHERE matricule = ?").get(request.employee_matricule) as any;
      const recipientEmail = employeeUser ? employeeUser.email : updatedRequest.creator_email;

      if (recipientEmail) {
        const statusLabels: any = {
          pending_hr: 'Validated by manager (pending HR)',
          approved: 'Approved',
          rejected: 'Rejected'
        };
        
        const subject = `Update on your leave request: ${statusLabels[newStatus]}`;
        const html = `
          <h2>Update on your leave request</h2>
          <p>Your request for the period from ${request.start_date} to ${request.end_date} has been <strong>${statusLabels[newStatus]}</strong>.</p>
          <p>Current status: ${newStatus}</p>
        `;
        sendEmail(recipientEmail, subject, html);
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
      
      const creator = db.prepare("SELECT role, department_id FROM users WHERE id = ?").get(creatorId) as any;
      
      let initialStatus = 'pending_manager';
      if (creator.role === 'manager') {
        initialStatus = 'pending_hr';
      }

      const result = db.prepare(`
        INSERT INTO admin_document_requests (
          employee_name, employee_matricule, department_id, created_by_id, 
          type, purpose, status, target_manager_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        employeeName, employeeMatricule, departmentId, creatorId, 
        type, purpose, initialStatus, targetManagerId || null
      );
      
      const newRequest = db.prepare(`
        SELECT dr.*, cb.name as creator_name, cb.email as creator_email, d.name as department_name
        FROM admin_document_requests dr 
        JOIN users cb ON dr.created_by_id = cb.id
        LEFT JOIN departments d ON dr.department_id = d.id
        WHERE dr.id = ?
      `).get(result.lastInsertRowid) as any;
      
      io.emit("document_request_created", newRequest);

      // Email notifications
      const hrUsers = db.prepare("SELECT email FROM users WHERE role = 'hr'").all() as any[];
      const subject = `New document request: ${employeeName}`;
      const html = `
        <h2>New administrative document request</h2>
        <p><strong>Employee:</strong> ${employeeName} (${employeeMatricule})</p>
        <p><strong>Document Type:</strong> ${type}</p>
        <p><strong>Purpose:</strong> ${purpose}</p>
        <p>The request is pending validation.</p>
      `;

      hrUsers.forEach(hr => sendEmail(hr.email, subject, html));
      
      if (initialStatus === 'pending_manager') {
        const managers = db.prepare("SELECT email FROM users WHERE (role = 'manager' OR role = 'superior') AND department_id = ?").all(departmentId) as any[];
        managers.forEach(m => sendEmail(m.email, subject, html));
      }

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
      if (!request) return res.status(404).json({ error: "Request not found" });

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

      db.prepare(`
        UPDATE admin_document_requests 
        SET status = ?, manager_approved_at = ?, hr_treated_at = ? 
        WHERE id = ?
      `).run(newStatus, manager_approved_at, hr_treated_at, id);

      const updatedRequest = db.prepare(`
        SELECT dr.*, cb.name as creator_name, d.name as department_name
        FROM admin_document_requests dr 
        JOIN users cb ON dr.created_by_id = cb.id
        LEFT JOIN departments d ON dr.department_id = d.id
        WHERE dr.id = ?
      `).get(id) as any;
      
      io.emit("document_request_updated", updatedRequest);

      res.json(updatedRequest);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stats/documents", (req, res) => {
    try {
      const typeStats = db.prepare(`
        SELECT type, COUNT(*) as count 
        FROM admin_document_requests 
        GROUP BY type
      `).all();

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
        ORDER BY count DESC
        LIMIT 5
      `).all();

      res.json({ typeStats, deptStats, userStats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stats/departments", (req, res) => {
    try {
      const stats = db.prepare(`
        SELECT 
          d.name as department_name,
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}
setInterval(async () => {
  try {
    await fetch('https://hr-smart.onrender.com/');
    console.log('Keep-alive ping');
  } catch(e) {}
}, 10 * 60 * 1000);
startServer();
