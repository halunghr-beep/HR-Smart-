import React, { useState, useEffect } from 'react';
import {  
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { 
  Calendar, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Plus, 
  User, 
  LogOut, 
  LayoutDashboard, 
  FileText, 
  Users,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Filter,
  TrendingUp,
  Download,
  PieChart as PieChartIcon,
  Activity,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths, 
  isWithinInterval, 
  parseISO,
  isBefore,
  isAfter
} from 'date-fns';
import { enUS } from 'date-fns/locale';
import { cn } from './lib/utils';

// Types
interface User {
  id: number;
  name: string;
  email: string;
  role: 'employee' | 'superior' | 'manager' | 'hr' | 'ceo';
  department_id: number | null;
  department_name?: string;
  post_id: number | null;
  post_title?: string;
  balance: number;
  can_request: number;
  direct_to_ceo: number;
}

interface LeaveRequest {
  id: number;
  employee_name: string;
  employee_matricule: string;
  creator_name?: string;
  department_name?: string;
  type: 'paid' | 'sick' | 'unpaid' | 'other';
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: 'pending_manager' | 'pending_ceo' | 'pending_hr' | 'approved' | 'rejected';
  target_manager_id?: number;
  created_at: string;
  manager_approved_at?: string;
  ceo_approved_at?: string;
  hr_treated_at?: string;
}

const LEAVE_TYPES = {
  paid: { label: 'Paid Leave', color: 'bg-blue-100 text-blue-700' },
  sick: { label: 'Breastfeeding Leave', color: 'bg-red-100 text-pink-700' },
  unpaid: { label: 'Unpaid Leave', color: 'bg-gray-100 text-gray-700' },
  other: { label: 'Other', color: 'bg-purple-100 text-purple-700' },
};

const STATUS_STYLES = {
  pending_manager: 'bg-amber-100 text-amber-700',
  pending_ceo: 'bg-purple-100 text-purple-700',
  pending_hr: 'bg-indigo-100 text-indigo-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
};

const STATUS_LABELS = {
  pending_manager: 'Pending Manager',
  pending_ceo: 'Pending CEO',
  pending_hr: 'Pending HR',
  approved: 'Approved',
  rejected: 'Rejected',
};

interface AdminDocumentRequest {
  id: number;
  employee_name: string;
  employee_matricule: string;
  creator_name?: string;
  department_name?: string;
  type: 'work_attestation' | 'salary_attestation' | 'tax_certificate';
  purpose: 'CIN' | 'bank_credit';
  status: 'pending_manager' | 'pending_hr' | 'treated' | 'rejected';
  created_at: string;
  manager_approved_at?: string;
  hr_treated_at?: string;
}

const DOCUMENT_TYPES = {
  work_attestation: { label: 'Work Attestation', color: 'bg-blue-100 text-blue-700' },
  salary_attestation: { label: 'Salary Attestation', color: 'bg-emerald-100 text-emerald-700' },
  tax_certificate: { label: 'Tax Certificate', color: 'bg-amber-100 text-amber-700' },
};

const DOC_STATUS_LABELS = {
  pending_manager: 'Pending Manager',
  pending_hr: 'Pending HR',
  treated: 'Treated',
  rejected: 'Rejected',
};

const DOC_STATUS_STYLES = {
  pending_manager: 'bg-amber-100 text-amber-700',
  pending_hr: 'bg-indigo-100 text-indigo-700',
  treated: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [docRequests, setDocRequests] = useState<AdminDocumentRequest[]>([]);
  const [deptStats, setDeptStats] = useState<any[]>([]);
  const [docStats, setDocStats] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'structure' | 'calendar' | 'hr-overview' | 'ceo-overview' | 'documents'>('dashboard');
  const [dashboardFilter, setDashboardFilter] = useState({
    status: 'all',
    departmentId: 'all',
    search: '',
  });
  const [docFilter, setDocFilter] = useState({
    status: 'all',
    type: 'all',
    search: '',
  });
  const [currentCalendarDate, setCurrentCalendarDate] = useState(new Date());
  const [calendarFilter, setCalendarFilter] = useState({ departmentId: '' });
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [showNewDocModal, setShowNewDocModal] = useState(false);
  const [showNewUserModal, setShowNewUserModal] = useState(false);
  const [showNewDeptModal, setShowNewDeptModal] = useState(false);
  const [showNewPostModal, setShowNewPostModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);
  const [selectedUserForHistory, setSelectedUserForHistory] = useState<User | null>(null);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<User | null>(null);
  const [editUserForm, setEditUserForm] = useState<any>({});
  const [socket, setSocket] = useState<Socket | null>(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    employeeName: '',
    employeeMatricule: '',
    type: 'paid' as LeaveRequest['type'],
    startDate: '',
    endDate: '',
    reason: '',
    targetManagerId: '',
  });

  const [docFormData, setDocFormData] = useState({
    employeeName: '',
    employeeMatricule: '',
    type: 'work_attestation' as AdminDocumentRequest['type'],
    purpose: 'CIN' as AdminDocumentRequest['purpose'],
    targetManagerId: '',
    project: '',
    departmentId: '',
  });

  // User Form State
  const [userFormData, setUserFormData] = useState({
    name: '',
    email: '',
    password: '',
    matricule: '',
    role: 'superior' as User['role'],
    departmentId: '',
    postId: '',
    canRequest: true,
    directToCeo: false,
  });

  const [deptFormData, setDeptFormData] = useState({ name: '' });
  const [postFormData, setPostFormData] = useState({ title: '', departmentId: '' });

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('leave_request_updated', (updatedRequest: LeaveRequest) => {
      setRequests(prev => prev.map(r => r.id === updatedRequest.id ? updatedRequest : r));
      if (currentUser?.role === 'hr') {
        fetchDeptStats();
        fetchUsers();
      }
    });

    newSocket.on('leave_request_created', (newRequest: LeaveRequest) => {
      setRequests(prev => [newRequest, ...prev]);
      if (currentUser?.role === 'hr') {
        fetchDeptStats();
      }
    });

    newSocket.on('document_request_created', (newRequest: AdminDocumentRequest) => {
      setDocRequests(prev => [newRequest, ...prev]);
      if (currentUser?.role === 'hr') {
        fetchDocStats();
      }
    });

    newSocket.on('document_request_updated', (updatedRequest: AdminDocumentRequest) => {
      setDocRequests(prev => prev.map(r => r.id === updatedRequest.id ? updatedRequest : r));
      if (currentUser?.role === 'hr') {
        fetchDocStats();
      }
    });

    fetchUsers();
    fetchDepartments();
    fetchPosts();

    return () => {
      newSocket.close();
    };
  }, [currentUser?.id]);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      setAvailableUsers(data);
      setLoading(false);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDepartments = async () => {
    try {
      const res = await fetch('/api/departments');
      const data = await res.json();
      setDepartments(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchPosts = async () => {
    try {
      const res = await fetch('/api/posts');
      const data = await res.json();
      setPosts(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRequests = async (user: User) => {
    try {
      const res = await fetch(`/api/leave-requests?userId=${user.id}&role=${user.role}&departmentId=${user.department_id || ''}`);
      const data = await res.json();
      setRequests(data);
      
      const docRes = await fetch(`/api/document-requests?userId=${user.id}&role=${user.role}&departmentId=${user.department_id || ''}`);
      const docData = await docRes.json();
      setDocRequests(docData);

      if (user.role === 'hr' || user.role === 'ceo') {
        fetchDeptStats();
        fetchDocStats();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDeptStats = async () => {
    try {
      const res = await fetch('/api/stats/departments');
      const data = await res.json();
      setDeptStats(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDocStats = async () => {
    try {
      const res = await fetch('/api/stats/documents');
      const data = await res.json();
      setDocStats(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setCurrentUser(data);
        fetchRequests(data);
        if (data.role === 'hr') setActiveTab('hr-overview');
        else if (data.role === 'ceo') setActiveTab('ceo-overview');
        else setActiveTab('dashboard');
      } else {
        setLoginError(data.error || 'Login error');
      }
    } catch (err) {
      setLoginError('Server unreachable');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setRequests([]);
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    try {
      const res = await fetch('/api/leave-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: currentUser.id,
          departmentId: currentUser.department_id,
          employeeName: formData.employeeName,
          employeeMatricule: formData.employeeMatricule,
          type: formData.type,
          startDate: formData.startDate,
          endDate: formData.endDate,
          days: diffDays,
          reason: formData.reason,
          targetManagerId: formData.targetManagerId ? parseInt(formData.targetManagerId) : null,
directToCeo: availableUsers.find(u => u.matricule === formData.employeeMatricule)?.direct_to_ceo ?? currentUser.direct_to_ceo,
        }),
      });
      if (res.ok) {
        setShowNewRequestModal(false);
        setFormData({ employeeName: '', employeeMatricule: '', type: 'paid', startDate: '', endDate: '', reason: '', targetManagerId: '' });
      } else {
        const data = await res.json();
        alert(data.error || 'Error during submission');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmitDocRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    try {
      const res = await fetch('/api/document-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId: currentUser.id,
          departmentId: currentUser.department_id,
          employeeName: docFormData.employeeName,
          employeeMatricule: docFormData.employeeMatricule,
          type: docFormData.type,
          purpose: docFormData.purpose,
          targetManagerId: docFormData.targetManagerId ? parseInt(docFormData.targetManagerId) : null,
        }),
      });
      if (res.ok) {
        setShowNewDocModal(false);
        setDocFormData({ employeeName: '', employeeMatricule: '', type: 'work_attestation', purpose: 'CIN', targetManagerId: '' });
      } else {
        const data = await res.json();
        alert(data.error || 'Error during submission');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateDocStatus = async (id: number, action: 'approve' | 'reject') => {
    if (!currentUser) return;
    try {
      await fetch(`/api/document-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, role: currentUser.role }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...userFormData,
          departmentId: userFormData.role === 'hr' ? null : (userFormData.departmentId ? parseInt(userFormData.departmentId) : null),
          postId: userFormData.role === 'hr' ? null : (userFormData.postId ? parseInt(userFormData.postId) : null)
        }),
      });
      if (res.ok) {
        setShowNewUserModal(false);
        setUserFormData({ name: '', email: '', password: '', matricule: '', role: 'superior', departmentId: '', postId: '', canRequest: true, directToCeo: false });
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deptFormData),
      });
      if (res.ok) {
        setShowNewDeptModal(false);
        setDeptFormData({ name: '' });
        fetchDepartments();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postFormData),
      });
      if (res.ok) {
        setShowNewPostModal(false);
        setPostFormData({ title: '', departmentId: '' });
        fetchPosts();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateStatus = async (id: number, action: 'approve' | 'reject') => {
    if (!currentUser) return;
    try {
      await fetch(`/api/leave-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, role: currentUser.role, userId: currentUser.id }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Calculate custom monthly stats (27th of prev month to 26th of current month)
  const getReportPeriod = (date: Date) => {
    const end = new Date(date.getFullYear(), date.getMonth(), 26, 23, 59, 59);
    const start = new Date(date.getFullYear(), date.getMonth() - 1, 27, 0, 0, 0);
    return { start, end };
  };

  const { start: periodStart, end: periodEnd } = getReportPeriod(new Date());

  const currentMonthRequests = requests.filter(r => {
    const start = parseISO(r.start_date);
    const end = parseISO(r.end_date);
    // Check if any part of the leave is within the 27th-26th period
    const isWithinPeriod = (
      isWithinInterval(start, { start: periodStart, end: periodEnd }) ||
      isWithinInterval(end, { start: periodStart, end: periodEnd }) ||
      (isBefore(start, periodStart) && isAfter(end, periodEnd))
    );
    return isWithinPeriod && r.status === 'approved';
  });

  const userMonthlyStats = currentMonthRequests.reduce((acc: any, curr) => {
    if (!acc[curr.employee_name]) {
      acc[curr.employee_name] = {
        name: curr.employee_name,
        matricule: curr.employee_matricule,
        dept: curr.department_name,
        totalDays: 0,
        requests: []
      };
    }
    acc[curr.employee_name].totalDays += curr.days;
    acc[curr.employee_name].requests.push(curr);
    return acc;
  }, {});

  const sortedUserStats: any[] = Object.values(userMonthlyStats).sort((a: any, b: any) => b.totalDays - a.totalDays);

  // Top stats for HR/CEO
  const topEmployee = sortedUserStats[0] || null;
  
  const deptMonthlyStats = currentMonthRequests.reduce((acc: any, curr) => {
    if (!acc[curr.department_name]) {
      acc[curr.department_name] = 0;
    }
    acc[curr.department_name] += curr.days;
    return acc;
  }, {});

  const topDepartment = Object.entries(deptMonthlyStats)
    .sort(([, a]: any, [, b]: any) => b - a)[0] || null;

  const handleExportCSV = () => {
    const headers = ["Employee", "Matricule", "Department", "Type", "Start", "End", "Days", "Reason"];
    const rows = currentMonthRequests.map(r => [
      r.employee_name,
      r.employee_matricule,
      r.department_name || '-',
      LEAVE_TYPES[r.type].label,
      r.start_date,
      r.end_date,
      r.days,
      r.reason || '-'
    ]);

    const csvContent = [
      ["Period Report", `From ${format(periodStart, 'dd/MM/yyyy')} to ${format(periodEnd, 'dd/MM/yyyy')}`],
      ["Top Department", topDepartment ? `${topDepartment[0]} (${topDepartment[1]} days)` : '-'],
      ["Top Employee", topEmployee ? `${topEmployee.name} (${topEmployee.totalDays} days)` : '-'],
      [],
      headers,
      ...rows
    ].map(e => e.join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `leave_report_${format(new Date(), 'MM_yyyy')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Monthly trend for the current year
  const monthlyTrend = Array.from({ length: 12 }, (_, i) => {
    const monthDate = new Date(new Date().getFullYear(), i, 1);
    const monthRequests = requests.filter(r => {
      const start = parseISO(r.start_date);
      return r.status === 'approved' && start.getFullYear() === new Date().getFullYear() && start.getMonth() === i;
    });
    const totalDays = monthRequests.reduce((sum, r) => sum + r.days, 0);
    return {
      month: format(monthDate, 'MMM', { locale: enUS }),
      days: totalDays
    };
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100">
          <div className="text-center mb-8">
            <div className="mb-4 flex justify-center">
              <div className="w-16 h-16 bg-[#0056b3] rounded-full flex items-center justify-center shadow-lg shadow-blue-200">
  <span className="text-white text-3xl font-bold italic">S</span>
</div> 
            </div>
            <p className="text-slate-500 mt-2">Halung Technics Tunisie</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {loginError && (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-3 text-rose-600 text-sm animate-shake">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="font-medium">{loginError}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Professional Email</label>
              <div className="relative">
                <input 
                  type="email" 
                  required
                  value={loginForm.email}
                  onChange={e => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                  placeholder="name@company.com"
                />
                <User className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Password</label>
              <div className="relative">
                <input 
                  type="password" 
                  required
                  value={loginForm.password}
                  onChange={e => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                  placeholder="••••••••"
                />
                <Clock className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <button 
              type="submit"
              disabled={isLoggingIn}
              className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Login'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center mb-4">Test Accounts</p>
            <div className="grid grid-cols-1 gap-2">
              <div className="p-3 bg-slate-50 rounded-xl text-[10px] text-slate-500">
                <p><span className="font-bold text-slate-700">HR:</span> marie@rh.com / marie123</p>
                <p><span className="font-bold text-slate-700">Manager:</span> karim@it.com / karim123</p>
                <p><span className="font-bold text-slate-700">Superior:</span> sami@it.com / sami123</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  const canApprove = (req: LeaveRequest) => {
    if ((currentUser.role === 'manager' || currentUser.role === 'superior') && req.status === 'pending_manager') {
      if (req.target_manager_id && req.target_manager_id !== currentUser.id) return false;
      return true;
    }
    if (currentUser.role === 'ceo' && req.status === 'pending_ceo') return true;
    if (currentUser.role === 'hr' && req.status === 'pending_hr') return true;
    return false;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col hidden lg:flex">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-8">
            <img 
              src="/logo.png" 
              alt="Smart-HR" 
              className="h-12 w-auto object-contain"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement!.innerHTML = `
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-[#0056b3] rounded-full flex items-center justify-center shadow-sm">
                      <span class="text-white text-xl font-bold italic">S</span>
                    </div>
                    <span class="text-[#0056b3] font-bold text-lg tracking-tight">Smart-HR</span>
                  </div>
                `;
              }}
            />
          </div>
          
          <nav className="space-y-1">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors",
                activeTab === 'dashboard' ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <LayoutDashboard className="w-5 h-5" />
              Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('calendar')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors",
                activeTab === 'calendar' ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <Calendar className="w-5 h-5" />
              Calendar
            </button>
            {currentUser.role === 'ceo' && (
              <button 
                onClick={() => setActiveTab('ceo-overview')}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors",
                  activeTab === 'ceo-overview' ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <TrendingUp className="w-5 h-5" />
                CEO View
              </button>
            )}
            {currentUser.role === 'hr' && (
              <>
                <button 
                  onClick={() => setActiveTab('hr-overview')}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors",
                    activeTab === 'hr-overview' ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <TrendingUp className="w-5 h-5" />
                  Overview
                </button>
                <button 
                  onClick={() => setActiveTab('users')}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors",
                    activeTab === 'users' ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <Users className="w-5 h-5" />
                  Users
                </button>
                <button 
                  onClick={() => setActiveTab('structure')}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors",
                    activeTab === 'structure' ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <LayoutDashboard className="w-5 h-5" />
                  Structure
                </button>
              </>
            )}
            <button 
              onClick={() => setActiveTab('documents')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors",
                activeTab === 'documents' ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <FileText className="w-5 h-5" />
              Administrative Documents
            </button>
          </nav>
        </div>

        <div className="mt-auto p-6 border-t border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
              <User className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <p className="font-semibold text-slate-900 truncate leading-tight">{currentUser.name}</p>
              <p className="text-[10px] text-slate-500 uppercase font-bold">{currentUser.role}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-all text-sm"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="bg-white border-b border-slate-200 p-6 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {activeTab === 'users' ? 'User Management' : 
               activeTab === 'structure' ? 'Company Structure' :
               activeTab === 'hr-overview' ? 'Analytics Dashboard' :
               activeTab === 'ceo-overview' ? 'CEO Portal • Michael Ahalung' :
               currentUser.role === 'hr' ? 'Global HR Portal' : 
               currentUser.role === 'ceo' ? 'CEO Portal' :
               currentUser.role === 'manager' ? `Manager Portal • ${currentUser.department_name}` :
               currentUser.role === 'superior' ? `Superior Portal • ${currentUser.department_name}` :
               'My Personal Space'}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            {(currentUser?.role === 'superior' || currentUser?.direct_to_ceo === 1) && activeTab === 'dashboard' && (
              <button 
                onClick={() => setShowNewRequestModal(true)}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all"
              >
                <Plus className="w-5 h-5" />
                Create Request
              </button>
            )}
            {(currentUser?.role === 'superior' || currentUser?.direct_to_ceo === 1) && activeTab === 'documents' && (
              <button 
                onClick={() => setShowNewDocModal(true)}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all"
              >
                <Plus className="w-5 h-5" />
                Request Document
              </button>
            )}
            {currentUser.role === 'hr' && activeTab === 'structure' && (
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowNewDeptModal(true)}
                  className="bg-white text-slate-700 border border-slate-200 px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 hover:bg-slate-50 transition-all"
                >
                  <Plus className="w-5 h-5" />
                  New Department
                </button>
                <button 
                  onClick={() => setShowNewPostModal(true)}
                  className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all"
                >
                  <Plus className="w-5 h-5" />
                  New Post
                </button>
              </div>
            )}
            {currentUser.role === 'hr' && activeTab === 'users' && (
              <button 
                onClick={() => setShowNewUserModal(true)}
                className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all"
              >
                <Plus className="w-5 h-5" />
                New User
              </button>
            )}
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto space-y-8">
          {(activeTab === 'hr-overview' || activeTab === 'ceo-overview') && (currentUser.role === 'hr' || currentUser.role === 'ceo') ? (
            <div className="space-y-8">
              {/* HR/CEO Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:border-indigo-100 transition-all cursor-pointer group" onClick={() => { setActiveTab('dashboard'); setDashboardFilter({ ...dashboardFilter, status: 'all' }); }}>
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 mb-4 group-hover:bg-blue-600 group-hover:text-white transition-all">
                    <Activity className="w-6 h-6" />
                  </div>
                  <p className="text-slate-500 font-medium text-sm">Total Requests</p>
                  <h3 className="text-2xl font-bold text-slate-900 mt-1">{requests.length}</h3>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:border-amber-100 transition-all cursor-pointer group" onClick={() => { setActiveTab('dashboard'); setDashboardFilter({ ...dashboardFilter, status: 'pending_hr' }); }}>
                  <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 mb-4 group-hover:bg-amber-600 group-hover:text-white transition-all">
                    <Clock className="w-6 h-6" />
                  </div>
                  <p className="text-slate-500 font-medium text-sm">Pending HR</p>
                  <h3 className="text-2xl font-bold text-slate-900 mt-1">
                    {requests.filter(r => r.status === 'pending_hr').length}
                  </h3>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:border-emerald-100 transition-all cursor-pointer group" onClick={() => { setActiveTab('dashboard'); setDashboardFilter({ ...dashboardFilter, status: 'approved' }); }}>
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mb-4 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <p className="text-slate-500 font-medium text-sm">Approved</p>
                  <h3 className="text-2xl font-bold text-slate-900 mt-1">
                    {requests.filter(r => r.status === 'approved').length}
                  </h3>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:border-rose-100 transition-all cursor-pointer group" onClick={() => { setActiveTab('dashboard'); setDashboardFilter({ ...dashboardFilter, status: 'rejected' }); }}>
                  <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-600 mb-4 group-hover:bg-rose-600 group-hover:text-white transition-all">
                    <XCircle className="w-6 h-6" />
                  </div>
                  <p className="text-slate-500 font-medium text-sm">Rejected</p>
                  <h3 className="text-2xl font-bold text-slate-900 mt-1">
                    {requests.filter(r => r.status === 'rejected').length}
                  </h3>
                </div>
              </div>

              {/* Quick Actions for HR */}
              {currentUser.role === 'hr' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <button 
                    onClick={() => setShowNewUserModal(true)}
                    className="flex items-center gap-4 p-4 bg-white rounded-3xl border border-slate-100 shadow-sm hover:bg-slate-50 transition-all group"
                  >
                    <div className="w-10 h-10 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                      <Plus className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-slate-900 text-sm">New User</p>
                      <p className="text-[10px] text-slate-500">Add an employee to the system</p>
                    </div>
                  </button>
                  <button 
                    onClick={() => setShowNewDeptModal(true)}
                    className="flex items-center gap-4 p-4 bg-white rounded-3xl border border-slate-100 shadow-sm hover:bg-slate-50 transition-all group"
                  >
                    <div className="w-10 h-10 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                      <LayoutDashboard className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-slate-900 text-sm">New Department</p>
                      <p className="text-[10px] text-slate-500">Manage organizational structure</p>
                    </div>
                  </button>
                  <button 
                    onClick={handleExportCSV}
                    className="flex items-center gap-4 p-4 bg-white rounded-3xl border border-slate-100 shadow-sm hover:bg-slate-50 transition-all group"
                  >
                    <div className="w-10 h-10 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-all">
                      <Download className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-slate-900 text-sm">Export Data</p>
                      <p className="text-[10px] text-slate-500">Download monthly report</p>
                    </div>
                  </button>
                </div>
              )}

              {/* Pending Actions Section (HR or CEO) */}
              {((currentUser.role === 'hr' && requests.filter(r => r.status === 'pending_hr').length > 0) || 
                (currentUser.role === 'ceo' && requests.filter(r => r.status === 'pending_ceo').length > 0)) && (
                <div className={cn(
                  "bg-white rounded-3xl border shadow-sm overflow-hidden",
                  currentUser.role === 'hr' ? "border-rose-100" : "border-purple-100"
                )}>
                  <div className={cn(
                    "p-6 border-b flex items-center justify-between",
                    currentUser.role === 'hr' ? "border-rose-50 bg-rose-50/30" : "border-purple-50 bg-purple-50/30"
                  )}>
                    <h3 className={cn(
                      "font-bold flex items-center gap-2",
                      currentUser.role === 'hr' ? "text-rose-900" : "text-purple-900"
                    )}>
                      <AlertCircle className={cn("w-5 h-5", currentUser.role === 'hr' ? "text-rose-600" : "text-purple-600")} />
                      {currentUser.role === 'hr' ? 'HR' : 'CEO'} Actions Required ({
                        requests.filter(r => r.status === (currentUser.role === 'hr' ? 'pending_hr' : 'pending_ceo')).length
                      })
                    </h3>
                    <button 
                      onClick={() => { 
                        setActiveTab('dashboard'); 
                        setDashboardFilter({ ...dashboardFilter, status: currentUser.role === 'hr' ? 'pending_hr' : 'pending_ceo' }); 
                      }}
                      className={cn("text-xs font-bold hover:underline", currentUser.role === 'hr' ? "text-rose-600" : "text-purple-600")}
                    >
                      See all
                    </button>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {requests.filter(r => r.status === (currentUser.role === 'hr' ? 'pending_hr' : 'pending_ceo')).slice(0, 5).map((req) => (
                      <div key={req.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center font-bold",
                            currentUser.role === 'hr' ? "bg-indigo-50 text-indigo-600" : "bg-purple-50 text-purple-600"
                          )}>
                            {req.employee_name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{req.employee_name}</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider">{LEAVE_TYPES[req.type].label} • {req.days} days</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleUpdateStatus(req.id, 'approve')}
                            className={cn(
                              "px-3 py-1.5 text-white rounded-lg text-xs font-bold transition-colors",
                              currentUser.role === 'hr' ? "bg-emerald-600 hover:bg-emerald-700" : "bg-purple-600 hover:bg-purple-700"
                            )}
                          >
                            Approve
                          </button>
                          <button 
                            onClick={() => handleUpdateStatus(req.id, 'reject')}
                            className="px-3 py-1.5 bg-white text-rose-600 border border-rose-200 rounded-lg text-xs font-bold hover:bg-rose-50 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Report Period Info */}
              <div className="bg-indigo-600 p-6 rounded-3xl text-white shadow-lg shadow-indigo-200 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg">Period Report</h3>
                    <p className="text-indigo-100 text-sm">From {format(periodStart, 'dd/MM/yyyy')} to {format(periodEnd, 'dd/MM/yyyy')}</p>
                  </div>
                </div>
                <div className="flex flex-col md:flex-row items-center gap-8">
                  <div className="grid grid-cols-2 gap-8">
                    <div className="text-center">
                      <p className="text-indigo-200 text-[10px] font-bold uppercase tracking-widest mb-1">Top Department</p>
                      <p className="font-bold text-xl">{topDepartment ? topDepartment[0] : '-'}</p>
                      <p className="text-indigo-100 text-xs">{topDepartment ? topDepartment[1] : 0} days total</p>
                    </div>
                    <div className="text-center">
                      <p className="text-indigo-200 text-[10px] font-bold uppercase tracking-widest mb-1">Top Employee</p>
                      <p className="font-bold text-xl">{topEmployee ? topEmployee.name : '-'}</p>
                      <p className="text-indigo-100 text-xs">{topEmployee ? topEmployee.totalDays : 0} days this month</p>
                    </div>
                  </div>
                  <button 
                    onClick={handleExportCSV}
                    className="flex items-center gap-2 bg-white/20 hover:bg-white/30 transition-colors px-6 py-3 rounded-2xl font-bold text-sm border border-white/30"
                  >
                    <Download className="w-4 h-4" />
                    Export CSV
                  </button>
                </div>
              </div>

              {/* Monthly Trend Chart */}
              <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-indigo-600" />
                    Annual Evolution of Approved Leaves
                  </h3>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="month" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#64748b', fontSize: 12 }}
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                      <Tooltip 
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="days" name="Days" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Charts Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-indigo-600" />
                      Requests by Department
                    </h3>
                  </div>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={deptStats}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="department_name" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#64748b', fontSize: 12 }}
                        />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <Tooltip 
                          cursor={{ fill: '#f8fafc' }}
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend iconType="circle" />
                        <Bar dataKey="approved" name="Approved" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="pending_manager" name="Pending Manager" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="pending_ceo" name="Pending CEO" fill="#a855f7" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="pending_hr" name="Pending HR" fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                      <PieChartIcon className="w-5 h-5 text-indigo-600" />
                      Distribution by Type
                    </h3>
                  </div>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={Object.entries(LEAVE_TYPES).map(([key, value]) => ({
                            name: value.label,
                            value: requests.filter(r => r.type === key).length,
                            color: key === 'paid' ? '#3b82f6' : key === 'sick' ? '#ef4444' : key === 'unpaid' ? '#94a3b8' : '#a855f7'
                          }))}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {Object.entries(LEAVE_TYPES).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={
                              entry[0] === 'paid' ? '#3b82f6' : 
                              entry[0] === 'sick' ? '#ef4444' : 
                              entry[0] === 'unpaid' ? '#94a3b8' : '#a855f7'
                            } />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Who's Away Today */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">Currently on Leave</h3>
                  <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold">
                    {requests.filter(r => 
                      r.status === 'approved' && 
                      isWithinInterval(new Date(), { start: parseISO(r.start_date), end: parseISO(r.end_date) })
                    ).length} employees
                  </span>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {requests
                      .filter(r => 
                        r.status === 'approved' && 
                        isWithinInterval(new Date(), { start: parseISO(r.start_date), end: parseISO(r.end_date) })
                      )
                      .map(req => (
                        <div key={req.id} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-indigo-600 font-bold shadow-sm">
                            {req.employee_name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{req.employee_name}</p>
                            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{req.department_name}</p>
                          </div>
                        </div>
                      ))}
                    {requests.filter(r => 
                      r.status === 'approved' && 
                      isWithinInterval(new Date(), { start: parseISO(r.start_date), end: parseISO(r.end_date) })
                    ).length === 0 && (
                      <div className="col-span-full py-8 text-center text-slate-400 text-sm italic">
                        Everyone is present today
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Monthly Leave by User & Balances */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900">Leaves by User (Period: {format(periodStart, 'dd/MM')} to {format(periodEnd, 'dd/MM')})</h3>
                    <span className="text-xs text-slate-500 font-medium">Total accumulated days</span>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {sortedUserStats.map((stat: any) => (
                        <div key={stat.matricule} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-indigo-600 font-bold shadow-sm">
                              {stat.name.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-900 truncate">{stat.name}</p>
                              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{stat.dept}</p>
                            </div>
                            <div className="text-right">
                              <span className="text-lg font-black text-indigo-600">{stat.totalDays}</span>
                              <span className="text-[10px] text-slate-400 font-bold ml-0.5">d</span>
                            </div>
                          </div>
                          <div className="flex gap-1 flex-wrap">
                            {stat.requests.map((r: any) => (
                              <span key={r.id} className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold uppercase", LEAVE_TYPES[r.type].color)}>
                                {r.days}d
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                      {sortedUserStats.length === 0 && (
                        <div className="col-span-full py-8 text-center text-slate-400 text-sm italic">
                          No leaves processed for this month
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-50">
                    <h3 className="font-bold text-slate-900">Leave Balances</h3>
                  </div>
                  <div className="p-6">
                    <div className="space-y-4">
                      {availableUsers.filter(u => u.role !== 'ceo').slice(0, 10).map((user) => (
                        <div key={user.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-xs font-bold">
                              {user.name.charAt(0)}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-900">{user.name}</p>
                              <p className="text-[9px] text-slate-500 uppercase">{user.department_name || 'Global'}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className={cn(
                              "text-sm font-bold",
                              user.balance < 5 ? "text-rose-600" : "text-emerald-600"
                            )}>
                              {user.balance}d
                            </span>
                          </div>
                        </div>
                      ))}
                      <button 
                        onClick={() => setActiveTab('users')}
                        className="w-full py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors mt-2"
                      >
                        Manage all users
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === 'documents' ? (
            <div className="space-y-8">
              {/* Document Stats for HR */}
              {currentUser.role === 'hr' && docStats && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                    <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                      <PieChartIcon className="w-5 h-5 text-indigo-600" />
                      By Document Type
                    </h3>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={docStats.typeStats.map((s: any) => ({
                              name: DOCUMENT_TYPES[s.type as keyof typeof DOCUMENT_TYPES]?.label || s.type,
                              value: s.count
                            }))}
                            cx="50%"
                            cy="50%"
                            innerRadius={40}
                            outerRadius={60}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {docStats.typeStats.map((_: any, index: number) => (
                              <Cell key={`cell-${index}`} fill={['#3b82f6', '#10b981', '#f59e0b'][index % 3]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                    <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                      <Users className="w-5 h-5 text-emerald-600" />
                      Top Employees (Requests)
                    </h3>
                    <div className="space-y-4">
                      {docStats.userStats.map((s: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-600">{s.employee_name}</span>
                          <span className="px-2 py-1 bg-slate-50 rounded-lg text-xs font-bold text-slate-900">{s.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                    <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                      <LayoutDashboard className="w-5 h-5 text-amber-600" />
                      By Department
                    </h3>
                    <div className="space-y-4">
                      {docStats.deptStats.map((s: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-600">{s.department_name}</span>
                          <span className="px-2 py-1 bg-slate-50 rounded-lg text-xs font-bold text-slate-900">{s.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Document Requests List */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">Document Requests</h3>
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input 
                        type="text"
                        placeholder="Search..."
                        value={docFilter.search}
                        onChange={e => setDocFilter(prev => ({ ...prev, search: e.target.value }))}
                        className="pl-9 pr-4 py-2 bg-slate-50 border-none rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none w-48"
                      />
                    </div>
                    <select 
                      value={docFilter.status}
                      onChange={e => setDocFilter(prev => ({ ...prev, status: e.target.value }))}
                      className="bg-slate-50 border-none rounded-xl text-xs px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                      <option value="all">All Statuses</option>
                      <option value="pending_manager">Pending Manager</option>
                      <option value="pending_hr">Pending HR</option>
                      <option value="treated">Treated</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50/50">
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Employee</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Document Type</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Purpose</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Status</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {docRequests
                        .filter(r => {
                          if (docFilter.status !== 'all' && r.status !== docFilter.status) return false;
                          if (docFilter.search && !r.employee_name.toLowerCase().includes(docFilter.search.toLowerCase()) && !r.employee_matricule.toLowerCase().includes(docFilter.search.toLowerCase())) return false;
                          return true;
                        })
                        .map((req) => (
                        <tr key={req.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 text-[10px] font-bold">
                                {req.employee_name.charAt(0)}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-900 leading-tight">{req.employee_name}</p>
                                <p className="text-[10px] text-slate-500 uppercase font-medium">{req.employee_matricule} • {req.department_name}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide", DOCUMENT_TYPES[req.type].color)}>
                              {DOCUMENT_TYPES[req.type].label}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded-lg">
                              {req.purpose === 'CIN' ? 'For CIN' : 'Bank Credit'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-xs font-medium text-slate-600">{format(parseISO(req.created_at), 'dd MMM yyyy')}</p>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide", DOC_STATUS_STYLES[req.status])}>
                              {DOC_STATUS_LABELS[req.status]}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {((currentUser.role === 'manager' || currentUser.role === 'superior') && req.status === 'pending_manager') && (
                                <>
                                  <button 
                                    onClick={() => handleUpdateDocStatus(req.id, 'approve')}
                                    className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-600 hover:text-white transition-all"
                                    title="Approve"
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => handleUpdateDocStatus(req.id, 'reject')}
                                    className="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-600 hover:text-white transition-all"
                                    title="Reject"
                                  >
                                    <XCircle className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                              {(currentUser.role === 'hr' && req.status === 'pending_hr') && (
                                <button 
                                  onClick={() => handleUpdateDocStatus(req.id, 'approve')}
                                  className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold hover:bg-indigo-700 transition-all uppercase tracking-widest"
                                >
                                  Treat
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {docRequests.length === 0 && (
                    <div className="py-12 text-center">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <FileText className="w-8 h-8 text-slate-300" />
                      </div>
                      <p className="text-slate-400 text-sm italic">No document request found</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === 'dashboard' ? (
            <>
              {/* Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                  <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600 mb-4">
                    <Clock className="w-6 h-6" />
                  </div>
                  <p className="text-slate-500 font-medium text-sm">Pending Manager</p>
                  <h3 className="text-2xl font-bold text-slate-900 mt-1">
                    {requests.filter(r => r.status === 'pending_manager').length}
                  </h3>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                  <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600 mb-4">
                    <Activity className="w-6 h-6" />
                  </div>
                  <p className="text-slate-500 font-medium text-sm">Pending CEO</p>
                  <h3 className="text-2xl font-bold text-slate-900 mt-1">
                    {requests.filter(r => r.status === 'pending_ceo').length}
                  </h3>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                  <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 mb-4">
                    <Users className="w-6 h-6" />
                  </div>
                  <p className="text-slate-500 font-medium text-sm">Pending HR</p>
                  <h3 className="text-2xl font-bold text-slate-900 mt-1">
                    {requests.filter(r => r.status === 'pending_hr').length}
                  </h3>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mb-4">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <p className="text-slate-500 font-medium text-sm">Treated</p>
                  <h3 className="text-2xl font-bold text-slate-900 mt-1">
                    {requests.filter(r => r.status === 'approved').length}
                  </h3>
                </div>
              </div>

              {/* Department Stats for HR */}
              {currentUser.role === 'hr' && deptStats.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-slate-900 px-2">Overview by Department</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {deptStats.map((stat, idx) => (
                      <div key={idx} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                        <h4 className="font-bold text-indigo-600 mb-4 flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          {stat.department_name}
                        </h4>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">Pending Manager</span>
                            <span className="font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg">{stat.pending_manager}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">Pending CEO</span>
                            <span className="font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-lg">{stat.pending_ceo}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">Pending HR</span>
                            <span className="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg">{stat.pending_hr}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">Treated</span>
                            <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg">{stat.approved}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Monthly Summary Section */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-indigo-600" />
                    Monthly Summary ({format(periodStart, 'dd/MM')} to {format(periodEnd, 'dd/MM')})
                  </h3>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Processed Leaves</span>
                </div>
                <div className="p-6">
                  <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                    {sortedUserStats.map((stat: any) => (
                      <div key={stat.matricule} className="flex-shrink-0 w-56 p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col gap-2 hover:border-indigo-100 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-indigo-600 font-bold text-sm shadow-sm">
                            {stat.name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">{stat.name}</p>
                            <p className="text-[10px] text-slate-500 font-medium truncate">{stat.dept}</p>
                          </div>
                          <div className="text-right">
                            <div className="flex flex-col items-end">
                              <span className="text-lg font-black text-indigo-600 leading-none">{stat.totalDays}</span>
                              <span className="text-[8px] text-slate-400 font-bold uppercase">days</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {sortedUserStats.length === 0 && (
                      <div className="w-full py-8 text-center text-slate-400 text-sm italic">
                        No leaves processed for this month
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Requests Table */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h3 className="font-bold text-slate-900">Request Flow</h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text"
                        placeholder="Search..."
                        value={dashboardFilter.search}
                        onChange={(e) => setDashboardFilter({ ...dashboardFilter, search: e.target.value })}
                        className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-48"
                      />
                    </div>
                    <select 
                      value={dashboardFilter.status}
                      onChange={(e) => setDashboardFilter({ ...dashboardFilter, status: e.target.value })}
                      className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="all">All Statuses</option>
                      <option value="pending_manager">Pending Manager</option>
                      <option value="pending_ceo">Pending CEO</option>
                      <option value="pending_hr">Pending HR</option>
                      <option value="approved">Treated</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    <select 
                      value={dashboardFilter.departmentId}
                      onChange={(e) => setDashboardFilter({ ...dashboardFilter, departmentId: e.target.value })}
                      className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="all">All Departments</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-wider font-bold">
                        <th className="px-6 py-4">Requester</th>
                        <th className="px-6 py-4">Type</th>
                        <th className="px-6 py-4">Period</th>
                        <th className="px-6 py-4">Date Tracking</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {requests
                        .filter(req => {
                          if (currentUser.role === 'ceo' && activeTab === 'dashboard') {
                            // CEO sees only manager/admin requests in his dashboard list
                            return req.status === 'pending_ceo' || req.ceo_approved_at;
                          }
                          return true;
                        })
                        .filter(req => {
                          if (dashboardFilter.status !== 'all' && req.status !== dashboardFilter.status) return false;
                          if (dashboardFilter.departmentId !== 'all' && req.department_id.toString() !== dashboardFilter.departmentId) return false;
                          if (dashboardFilter.search) {
                            const search = dashboardFilter.search.toLowerCase();
                            return (
                              req.employee_name.toLowerCase().includes(search) ||
                              req.employee_matricule.toLowerCase().includes(search)
                            );
                          }
                          return true;
                        })
                        .map((req) => (
                        <tr 
                          key={req.id} 
                          onClick={() => setSelectedRequest(req)}
                          className="hover:bg-slate-50/30 transition-colors cursor-pointer group/row"
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 text-[10px] font-bold group-hover/row:bg-indigo-100 transition-colors">
                                {req.employee_name?.charAt(0)}
                              </div>
                              <div>
                                <p className="text-slate-900 font-semibold text-sm leading-tight">{req.employee_name}</p>
                                <p className="text-[10px] text-slate-400 font-medium">Mat: {req.employee_matricule}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide", LEAVE_TYPES[req.type].color)}>
                              {LEAVE_TYPES[req.type].label}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-xs">
                              <p className="text-slate-900 font-semibold">{new Date(req.start_date).toLocaleDateString('fr-FR')}</p>
                              <p className="text-slate-400">to {new Date(req.end_date).toLocaleDateString('fr-FR')} ({req.days}d)</p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-[9px] space-y-1">
                              <p className="text-slate-500"><span className="font-bold">Created:</span> {format(parseISO(req.created_at), 'dd/MM HH:mm')}</p>
                              {req.manager_approved_at && <p className="text-amber-600"><span className="font-bold">Mgr:</span> {format(parseISO(req.manager_approved_at), 'dd/MM HH:mm')}</p>}
                              {req.ceo_approved_at && <p className="text-purple-600"><span className="font-bold">CEO:</span> {format(parseISO(req.ceo_approved_at), 'dd/MM HH:mm')}</p>}
                              {req.hr_treated_at && <p className="text-emerald-600"><span className="font-bold">HR:</span> {format(parseISO(req.hr_treated_at), 'dd/MM HH:mm')}</p>}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide", STATUS_STYLES[req.status])}>
                              {STATUS_LABELS[req.status]}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-2">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRequest(req);
                                }}
                                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors lg:opacity-0 lg:group-hover/row:opacity-100"
                                title="View details"
                              >
                                <FileText className="w-5 h-5" />
                              </button>
                              {canApprove(req) && (
                                <>
                                  <button 
                                    onClick={() => handleUpdateStatus(req.id, 'approve')}
                                    className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                                    title="Approve"
                                  >
                                    <CheckCircle2 className="w-5 h-5" />
                                  </button>
                                  <button 
                                    onClick={() => handleUpdateStatus(req.id, 'reject')}
                                    className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors"
                                    title="Reject"
                                  >
                                    <XCircle className="w-5 h-5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {requests.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-slate-400 text-sm">
                            No requests in this flow
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : activeTab === 'calendar' ? (
            <div className="space-y-6">
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 capitalize">
                      {format(currentCalendarDate, 'MMMM yyyy', { locale: enUS })}
                    </h2>
                    <p className="text-slate-500 text-sm">Overview of approved leaves</p>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex items-center bg-slate-100 rounded-xl p-1">
                      <button 
                        onClick={() => setCurrentCalendarDate(subMonths(currentCalendarDate, 1))}
                        className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-600"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => setCurrentCalendarDate(new Date())}
                        className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-indigo-600 transition-colors"
                      >
                        Today
                      </button>
                      <button 
                        onClick={() => setCurrentCalendarDate(addMonths(currentCalendarDate, 1))}
                        className="p-2 hover:bg-white hover:shadow-sm rounded-lg transition-all text-slate-600"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="h-8 w-px bg-slate-200 mx-2" />

                    <div className="relative">
                      <select 
                        value={calendarFilter.departmentId}
                        onChange={e => setCalendarFilter({ departmentId: e.target.value })}
                        className="pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none min-w-[180px]"
                      >
                        <option value="">All Departments</option>
                        {departments.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                      <Filter className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-2xl overflow-hidden border border-slate-200">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                    <div key={day} className="bg-slate-50 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      {day}
                    </div>
                  ))}
                  
                  {eachDayOfInterval({
                    start: startOfWeek(startOfMonth(currentCalendarDate), { weekStartsOn: 1 }),
                    end: endOfWeek(endOfMonth(currentCalendarDate), { weekStartsOn: 1 }),
                  }).map((day, idx) => {
                    const dayRequests = requests.filter(r => 
                      r.status === 'approved' && 
                      (!calendarFilter.departmentId || r.department_id === parseInt(calendarFilter.departmentId)) &&
                      isWithinInterval(day, {
                        start: parseISO(r.start_date),
                        end: parseISO(r.end_date)
                      })
                    );

                    return (
                      <div 
                        key={idx} 
                        className={cn(
                          "bg-white min-h-[120px] p-2 transition-colors",
                          !isSameMonth(day, currentCalendarDate) && "bg-slate-50/50",
                          isSameDay(day, new Date()) && "ring-2 ring-inset ring-indigo-500/20"
                        )}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className={cn(
                            "text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full",
                            isSameDay(day, new Date()) ? "bg-indigo-600 text-white" : "text-slate-400",
                            !isSameMonth(day, currentCalendarDate) && "opacity-30"
                          )}>
                            {format(day, 'd')}
                          </span>
                        </div>
                        
                        <div className="space-y-1">
                          {dayRequests.slice(0, 3).map((req, ridx) => (
                            <div 
                              key={ridx}
                              onClick={() => setSelectedRequest(req)}
                              className={cn(
                                "px-2 py-1 rounded-md text-[9px] font-bold truncate cursor-pointer transition-all hover:scale-[1.02] active:scale-95",
                                LEAVE_TYPES[req.type].color
                              )}
                              title={`${req.employee_name} - ${LEAVE_TYPES[req.type].label}`}
                            >
                              {req.employee_name}
                            </div>
                          ))}
                          {dayRequests.length > 3 && (
                            <p className="text-[9px] text-slate-400 font-bold pl-1">
                              + {dayRequests.length - 3} others
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {Object.entries(LEAVE_TYPES).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 bg-white px-4 py-3 rounded-2xl border border-slate-100 shadow-sm">
                    <div className={cn("w-3 h-3 rounded-full", value.color.split(' ')[0])} />
                    <span className="text-xs font-bold text-slate-600">{value.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : activeTab === 'structure' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Departments Section */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">Departments</h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-wide">
                    {departments.length}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-wider font-bold">
                        <th className="px-6 py-4">ID</th>
                        <th className="px-6 py-4">Department Name</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {departments.map((dept) => (
                        <tr key={dept.id} className="hover:bg-slate-50/30 transition-colors">
  <td className="px-6 py-4 text-sm text-slate-400 font-mono">#{dept.id}</td>
  <td className="px-6 py-4">
    <p className="text-slate-900 font-semibold text-sm">{dept.name}</p>
  </td>
  <td className="px-6 py-4 text-right flex gap-2">
    <button
      onClick={() => {
        const newName = window.prompt('Rename department:', dept.name);
        if (newName && newName.trim()) {
          fetch('/api/departments/' + dept.id, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name: newName.trim() })
          }).then(() => {
            setDepartments(prev => prev.map(d => d.id === dept.id ? {...d, name: newName.trim()} : d));
          });
        }
      }}
      className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-emerald-600 transition-all"
      title="Rename department"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </button>

  <button
    onClick={async () => {
      if (window.confirm('Delete this department?')) {
        await fetch('/api/departments/' + dept.id, { method: 'DELETE' });
        setDepartments(prev => prev.filter(d => d.id !== dept.id));
      }
    }}
    className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-rose-600 transition-all"
    title="Delete department"
  >
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/>
      <path d="M14 11v6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  </button>
</td>
</tr>
                      ))}
                    </tbody>
                  </table>
            </div>
          </div>

              {/* Posts Section */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">Roles / Titles</h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-wide">
                    {posts.length}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-wider font-bold">
                        <th className="px-6 py-4">Role Title</th>
                        <th className="px-6 py-4">Department</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {posts.map((post) => (
                        <tr key={post.id} className="hover:bg-slate-50/30 transition-colors">
  <td className="px-6 py-4">
    <p className="text-slate-900 font-semibold text-sm">{post.title}</p>
  </td>
  <td className="px-6 py-4">
    <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-bold uppercase tracking-wide">
      {post.department_name || 'Global'}
    </span>
  </td>
  <td className="px-6 py-4 text-right">
    <button
      onClick={async () => {
        if (window.confirm(`Delete "${post.title}"?`)) {
          await fetch(`/api/posts/${post.id}`, { method: 'DELETE' });
          setPosts(prev => prev.filter(p => p.id !== post.id));
        }
      }}
      className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-rose-600 transition-all"
      title="Delete post"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
    </button>
  </td>
</tr>
                      ))}
                      {posts.length === 0 && (
                        <tr>
                          <td colSpan={2} className="px-6 py-8 text-center text-slate-400 text-sm italic">
                            No role defined
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                <h3 className="font-bold text-slate-900">User List</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50/50 text-slate-500 text-[10px] uppercase tracking-wider font-bold">
                      <th className="px-6 py-4">User</th>
                      <th className="px-6 py-4">Role</th>
                      <th className="px-6 py-4">Department</th>
                      <th className="px-6 py-4">Request Right</th>
                      <th className="px-6 py-4">Direct to CEO</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {availableUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-slate-50/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 text-xs font-bold">
                              {user.name.charAt(0)}
                            </div>
                            <div>
                              <p className="text-slate-900 font-bold text-sm leading-tight">{user.name}</p>
                              <p className="text-[10px] text-slate-400 font-medium">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-wide">
                            {user.role}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500 font-medium">{user.department_name || '-'}</td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide",
                            user.can_request ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                          )}>
                            {user.can_request ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide",
                            user.direct_to_ceo ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-600"
                          )}>
                            {user.direct_to_ceo ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right flex items-center justify-end gap-2">
  <button
    onClick={() => { setSelectedUserForEdit(user); setEditUserForm(user); }}
    className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-emerald-600 transition-all"
    title="Edit user"
  >
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
  </button>
<button
  onClick={async () => {
    if (window.confirm(`Delete ${user.name}?`)) {
      await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      setAvailableUsers(prev => prev.filter(u => u.id !== user.id));
    }
  }}
  className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-rose-600 transition-all"
  title="Delete user"
>
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
</button>                          
  <button
    onClick={() => setSelectedUserForHistory(user)}
    className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 transition-all"
    title="View history"
  >
    <Clock className="w-4 h-4" />
  </button>
</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* New Request Modal */}
      <AnimatePresence>
        {showNewRequestModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewRequestModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-bold text-slate-900">New Request</h3>
                  <button 
                    onClick={() => setShowNewRequestModal(false)}
                    className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <form onSubmit={handleSubmitRequest} className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Employee Name</label>
                      <input 
                        type="text" 
                        required
                        value={formData.employeeName}
                        onChange={e => setFormData(prev => ({ ...prev, employeeName: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        placeholder="Ex: John Doe"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Employee ID</label>
                      <input 
                        type="text" 
                        required
                        value={formData.employeeMatricule}
                        onChange={e => setFormData(prev => ({ ...prev, employeeMatricule: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        placeholder="Ex: 2024-001"
                      />
                    </div>
                  </div>
{(currentUser?.role === 'hr' || currentUser?.role === 'superior' || currentUser?.role === 'manager') && (
  <div className="grid grid-cols-2 gap-4">
    <div>
      <label className="block text-sm font-bold text-slate-700 mb-2">Department</label>
      <select
        value={formData.departmentId}
        onChange={e => setFormData(prev => ({ ...prev, departmentId: e.target.value }))}
        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
      >
        <option value="">Select department</option>
        {departments.map(d => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
    </div>
    <div>
      <label className="block text-sm font-bold text-slate-700 mb-2">Project</label>
      <input
        type="text"
        value={formData.project}
        onChange={e => setFormData(prev => ({ ...prev, project: e.target.value }))}
        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        placeholder="Ex: Project Alpha"
      />
    </div>
  </div>
)}
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Leave Type</label>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.entries(LEAVE_TYPES).map(([key, value]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, type: key as any }))}
                          className={cn(
                            "px-4 py-3 rounded-xl border text-xs font-bold uppercase tracking-wide transition-all",
                            formData.type === key 
                              ? "border-indigo-600 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-100" 
                              : "border-slate-200 text-slate-600 hover:border-slate-300"
                          )}
                        >
                          {value.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Start</label>
                      <input 
                        type="date" 
                        required
                        value={formData.startDate}
                        onChange={e => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">End</label>
                      <input 
                        type="date" 
                        required
                        value={formData.endDate}
                        onChange={e => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Reason</label>
                    <textarea 
                      rows={2}
                      value={formData.reason}
                      onChange={e => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-sm"
                      placeholder="Absence details..."
                    />
                  </div>

                  {currentUser && currentUser.role !== 'manager' && currentUser.direct_to_ceo !== 1 && (
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Approving Manager</label>
                      <select
                        required
                        value={formData.targetManagerId}
                        onChange={e => setFormData(prev => ({ ...prev, targetManagerId: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      >
                        <option value="">Select a manager</option>
                        {availableUsers
                          .filter(u => u.role === 'manager')
                          .map(m => (
                            <option key={m.id} value={m.id}>{m.name} ({m.department_name || 'Global'})</option>
                          ))
                        }
                      </select>
                    </div>
                  )}

                  <div className="pt-4 flex gap-3">
                    <button 
                      type="button"
                      onClick={() => setShowNewRequestModal(false)}
                      className="flex-1 px-6 py-4 rounded-xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      className="flex-[2] bg-indigo-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all uppercase tracking-widest text-xs"
                    >
                      Send to Manager
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Document Request Modal */}
      <AnimatePresence>
        {showNewDocModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewDocModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-bold text-slate-900">Administrative Document Request</h3>
                  <button 
                    onClick={() => setShowNewDocModal(false)}
                    className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <form onSubmit={handleSubmitDocRequest} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Employee Name</label>
                      <input 
                        type="text" 
                        required
                        value={docFormData.employeeName}
                        onChange={e => setDocFormData(prev => ({ ...prev, employeeName: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        placeholder="Full Name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Employee ID</label>
                      <input 
                        type="text" 
                        required
                        value={docFormData.employeeMatricule}
                        onChange={e => setDocFormData(prev => ({ ...prev, employeeMatricule: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        placeholder="Ex: 2024-001"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Document Type</label>
                    <select 
                      required
                      value={docFormData.type}
                      onChange={e => setDocFormData(prev => ({ ...prev, type: e.target.value as any }))}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    >
                      <option value="work_attestation">Work Attestation</option>
                      <option value="salary_attestation">Salary Attestation</option>
                      <option value="tax_certificate">Tax Certificate</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Purpose (Required)</label>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => setDocFormData(prev => ({ ...prev, purpose: 'CIN' }))}
                        className={cn(
                          "px-4 py-3 rounded-xl border font-bold text-sm transition-all",
                          docFormData.purpose === 'CIN' ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        )}
                      >
                        For CIN
                      </button>
                      <button
                        type="button"
                        onClick={() => setDocFormData(prev => ({ ...prev, purpose: 'bank_credit' }))}
                        className={cn(
                          "px-4 py-3 rounded-xl border font-bold text-sm transition-all",
                          docFormData.purpose === 'bank_credit' ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        )}
                      >
                        Bank Credit
                      </button>
                    </div>
                    </div>
                  
                 {currentUser && currentUser.role !== 'manager' && currentUser.direct_to_ceo !== 1 && (
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Approving Manager</label>
                      <select
                        required
                        value={docFormData.targetManagerId}
                        onChange={e => setDocFormData(prev => ({ ...prev, targetManagerId: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      >
                        <option value="">Select a manager</option>
                        {availableUsers
                          .filter(u => u.role === 'manager')
                          .map(m => (
                            <option key={m.id} value={m.id}>{m.name} ({m.department_name || 'Global'})</option>
                          ))
                        }
                      </select>
                    </div>
                  )}

                  <div className="pt-4 flex gap-3">
                    <button 
                      type="button"
                      onClick={() => setShowNewDocModal(false)}
                      className="flex-1 px-6 py-4 rounded-xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      className="flex-1 px-6 py-4 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all uppercase tracking-widest text-xs"
                    >
                      Submit Request
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}

                    <div className="pt-4 flex gap-3">
                    <button 
                      type="button"
                      onClick={() => setShowNewDocModal(false)}
                      className="flex-1 px-6 py-4 rounded-xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      className="flex-1 px-6 py-4 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all uppercase tracking-widest text-xs"
                    >
                      Submit Request
                    </button>
                  </div>
                 </form>
                 </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New User Modal */}
      <AnimatePresence>
        {showNewUserModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewUserModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-bold text-slate-900">New User</h3>
                  <button 
                    onClick={() => setShowNewUserModal(false)}
                    className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <form onSubmit={handleCreateUser} className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Full Name</label>
                    <input 
                      type="text" 
                      required
                      value={userFormData.name}
                      onChange={e => setUserFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      placeholder="Ex: John Doe"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Email</label>
                    <input 
                      type="email" 
                      required
                      value={userFormData.email}
                      onChange={e => setUserFormData(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      placeholder="john@company.com"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Employee ID</label>
                    <input 
                      type="text" 
                      required
                      value={userFormData.matricule}
                      onChange={e => setUserFormData(prev => ({ ...prev, matricule: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      placeholder="Ex: 2024-005"
                    />
                  </div>

                  <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <input 
                      type="checkbox"
                      id="canRequest"
                      checked={userFormData.canRequest}
                      onChange={e => setUserFormData(prev => ({ ...prev, canRequest: e.target.checked }))}
                      className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="canRequest" className="text-sm font-bold text-slate-700 cursor-pointer">
                      Allow this user to submit leave requests
                    </label>
                  </div>

                  <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <input 
                      type="checkbox"
                      id="directToCeo"
                      checked={userFormData.directToCeo}
                      onChange={e => setUserFormData(prev => ({ ...prev, directToCeo: e.target.checked }))}
                      className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="directToCeo" className="text-sm font-bold text-slate-700 cursor-pointer">
                      Requests sent directly to CEO (Michael)
                    </label>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Password</label>
                    <input 
                      type="password" 
                      required
                      value={userFormData.password}
                      onChange={e => setUserFormData(prev => ({ ...prev, password: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      placeholder="••••••••"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Role</label>
                    <select 
                      required
                      value={userFormData.role}
                      onChange={e => setUserFormData(prev => ({ ...prev, role: e.target.value as any }))}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    >
                      <option value="superior">Superior</option>
                      <option value="manager">Manager</option>
                      <option value="hr">HR</option>
                    </select>
                  </div>

                  {userFormData.role !== 'hr' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Department</label>
                        <select 
                          required
                          value={userFormData.departmentId}
                          onChange={e => setUserFormData(prev => ({ ...prev, departmentId: e.target.value }))}
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        >
                          <option value="">Select...</option>
                          {departments.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Role / Title</label>
                        <select 
                          required
                          value={userFormData.postId}
                          onChange={e => setUserFormData(prev => ({ ...prev, postId: e.target.value }))}
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                        >
                          <option value="">Select...</option>
                          {posts.map(p => (
                            <option key={p.id} value={p.id}>{p.title}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 flex gap-3">
                    <button 
                      type="button"
                      onClick={() => setShowNewUserModal(false)}
                      className="flex-1 px-6 py-4 rounded-xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      className="flex-[2] bg-indigo-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all uppercase tracking-widest text-xs"
                    >
                      Create Account
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Department Modal */}
      <AnimatePresence>
        {showNewDeptModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewDeptModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-bold text-slate-900">New Department</h3>
                  <button 
                    onClick={() => setShowNewDeptModal(false)}
                    className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <form onSubmit={handleCreateDept} className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Department Name</label>
                    <input 
                      type="text" 
                      required
                      value={deptFormData.name}
                      onChange={e => setDeptFormData({ name: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      placeholder="Ex: Human Resources"
                    />
                  </div>

                  <div className="pt-4 flex gap-3">
                    <button 
                      type="button"
                      onClick={() => setShowNewDeptModal(false)}
                      className="flex-1 px-6 py-4 rounded-xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      className="flex-[2] bg-indigo-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all uppercase tracking-widest text-xs"
                    >
                      Create
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Post Modal */}
      <AnimatePresence>
        {showNewPostModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewPostModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-bold text-slate-900">New Role</h3>
                  <button 
                    onClick={() => setShowNewPostModal(false)}
                    className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <form onSubmit={handleCreatePost} className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Role Title</label>
                    <input 
                      type="text" 
                      required
                      value={postFormData.title}
                      onChange={e => setPostFormData(prev => ({ ...prev, title: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      placeholder="Ex: Senior Developer"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Department (Optional)</label>
                    <select 
                      value={postFormData.departmentId}
                      onChange={e => setPostFormData(prev => ({ ...prev, departmentId: e.target.value }))}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    >
                      <option value="">Global / None</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="pt-4 flex gap-3">
                    <button 
                      type="button"
                      onClick={() => setShowNewPostModal(false)}
                      className="flex-1 px-6 py-4 rounded-xl font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      className="flex-[2] bg-indigo-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all uppercase tracking-widest text-xs"
                    >
                      Create Role
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRequest(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-bold text-slate-900">Request Details</h3>
                  <button 
                    onClick={() => setSelectedRequest(null)}
                    className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl">
                    <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-lg font-bold">
                      {selectedRequest.employee_name?.charAt(0)}
                    </div>
                    <div>
                      <p className="text-slate-900 font-bold text-lg leading-tight">{selectedRequest.employee_name}</p>
                      <p className="text-sm text-slate-500 font-medium">Employee ID: {selectedRequest.employee_matricule}</p>
                    </div>
                    <div className="ml-auto">
                      <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide", STATUS_STYLES[selectedRequest.status])}>
                        {STATUS_LABELS[selectedRequest.status]}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Leave Type</p>
                      <p className="font-semibold text-slate-900">{LEAVE_TYPES[selectedRequest.type].label}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Duration</p>
                      <p className="font-semibold text-slate-900">{selectedRequest.days} days</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Start Date</p>
                      <p className="font-semibold text-slate-900">{new Date(selectedRequest.start_date).toLocaleDateString('en-US', { dateStyle: 'long' })}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">End Date</p>
                      <p className="font-semibold text-slate-900">{new Date(selectedRequest.end_date).toLocaleDateString('en-US', { dateStyle: 'long' })}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Reason for absence</p>
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 min-h-[80px]">
                      <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
                        {selectedRequest.reason || "No reason specified."}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium pt-4 border-t border-slate-100">
                    <p>Created by {selectedRequest.creator_name}</p>
                    <p>on {new Date(selectedRequest.created_at).toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
                  </div>

                  {canApprove(selectedRequest) && (
                    <div className="pt-4 flex gap-3">
                      <button 
                        onClick={() => {
                          handleUpdateStatus(selectedRequest.id, 'reject');
                          setSelectedRequest(null);
                        }}
                        className="flex-1 px-6 py-4 rounded-xl font-bold text-rose-600 border border-rose-100 hover:bg-rose-50 transition-all uppercase tracking-widest text-xs"
                      >
                        Reject
                      </button>
                      <button 
                        onClick={() => {
                          handleUpdateStatus(selectedRequest.id, 'approve');
                          setSelectedRequest(null);
                        }}
                        className="flex-[2] bg-emerald-600 text-white py-4 rounded-xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all uppercase tracking-widest text-xs"
                      >
                        Treat
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
{selectedUserForEdit && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => setSelectedUserForEdit(null)}
      className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
    />
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
    >
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-2xl font-bold text-slate-900">Edit User</h3>
          <button onClick={() => setSelectedUserForEdit(null)} className="p-2 rounded-full hover:bg-slate-100 text-slate-400">
            <XCircle className="w-6 h-6" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Full Name</label>
              <input type="text" value={editUserForm.name || ''} onChange={e => setEditUserForm((p:any) => ({...p, name: e.target.value}))} className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Email</label>
              <input type="email" value={editUserForm.email || ''} onChange={e => setEditUserForm((p:any) => ({...p, email: e.target.value}))} className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Employee ID</label>
              <input type="text" value={editUserForm.matricule || ''} onChange={e => setEditUserForm((p:any) => ({...p, matricule: e.target.value}))} className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Password</label>
              <input type="text" value={editUserForm.password || ''} onChange={e => setEditUserForm((p:any) => ({...p, password: e.target.value}))} className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Role</label>
              <select value={editUserForm.role || ''} onChange={e => setEditUserForm((p:any) => ({...p, role: e.target.value}))} className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500">
                <option value="superior">Superior</option>
                <option value="manager">Manager</option>
                <option value="hr">HR</option>
                <option value="ceo">CEO</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Department</label>
              <select value={editUserForm.department_id || ''} onChange={e => setEditUserForm((p:any) => ({...p, department_id: e.target.value}))} className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500">
                <option value="">None</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Leave Balance</label>
              <input type="number" value={editUserForm.balance || 0} onChange={e => setEditUserForm((p:any) => ({...p, balance: parseInt(e.target.value)}))} className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="flex flex-col gap-2 justify-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!editUserForm.can_request} onChange={e => setEditUserForm((p:any) => ({...p, can_request: e.target.checked ? 1 : 0}))} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium text-slate-700">Can request leave</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!editUserForm.direct_to_ceo} onChange={e => setEditUserForm((p:any) => ({...p, direct_to_ceo: e.target.checked ? 1 : 0}))} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium text-slate-700">Direct to CEO</span>
              </label>
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <button onClick={() => setSelectedUserForEdit(null)} className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50">Cancel</button>
            <button
              onClick={async () => {
                await fetch(`/api/users/${selectedUserForEdit.id}`, {
                  method: 'PATCH',
                  headers: {'Content-Type': 'application/json'},
                  body: JSON.stringify({
                    name: editUserForm.name,
                    email: editUserForm.email,
                    password: editUserForm.password,
                    matricule: editUserForm.matricule,
                    role: editUserForm.role,
                    departmentId: editUserForm.department_id,
                    postId: editUserForm.post_id,
                    balance: editUserForm.balance,
                    canRequest: editUserForm.can_request,
                    directToCeo: editUserForm.direct_to_ceo,
                  })
                });
                setSelectedUserForEdit(null);
                const res = await fetch(`/api/users`);
                setAvailableUsers(await res.json());
              }}
              className="flex-[2] bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700"
            >Save Changes</button>
          </div>
        </div>
      </div>
    </motion.div>
  </div>
)}
        {selectedUserForHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedUserForHistory(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xl">
                      {selectedUserForHistory.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Request History</h3>
                      <p className="text-sm text-slate-500">{selectedUserForHistory.name} • {selectedUserForHistory.matricule || 'No ID'}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedUserForHistory(null)}
                    className="p-2 rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <div className="max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                  {requests.filter(r => r.employee_matricule === selectedUserForHistory.matricule).length > 0 ? (
                    <div className="space-y-4">
                      {requests
                        .filter(r => r.employee_matricule === selectedUserForHistory.matricule)
                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                        .map((req) => (
                          <div key={req.id} className="p-4 rounded-2xl border border-slate-100 bg-slate-50/30 hover:bg-slate-50 transition-colors">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide", LEAVE_TYPES[req.type].color)}>
                                  {LEAVE_TYPES[req.type].label}
                                </span>
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                  {format(parseISO(req.created_at), 'dd MMM yyyy', { locale: enUS })}
                                </span>
                              </div>
                              <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide", STATUS_STYLES[req.status])}>
                                {STATUS_LABELS[req.status]}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-bold text-slate-900">
                                  From {format(parseISO(req.start_date), 'dd MMM', { locale: enUS })} to {format(parseISO(req.end_date), 'dd MMM yyyy', { locale: enUS })}
                                </p>
                                <p className="text-xs text-slate-500 mt-1 italic">"{req.reason || 'No reason specified'}"</p>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold text-slate-900">{req.days}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Days</p>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="py-12 text-center">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mx-auto mb-4">
                        <FileText className="w-8 h-8" />
                      </div>
                      <p className="text-slate-500 font-medium">No requests found for this user.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
