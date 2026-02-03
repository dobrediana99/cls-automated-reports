// backend/config/org.js – copy of src/config/org.js for Docker (backend-only context).
// Single source of truth for employees + managers. Keep in sync with src/config/org.js.

export const TIMEZONE = "Europe/Bucharest";

export const DEPARTMENTS = {
  MANAGEMENT: "Management",
  SALES: "Vanzari",
  OPERATIONS: "Operatiuni",
};

export const ORG = [
  { name: "Rafael Onișoară", email: "rafael.o@crystal-logistics-services.com", mondayUserId: 73046209, department: DEPARTMENTS.MANAGEMENT, role: "manager", target: 0, isActive: true },
  { name: "Alin Lita", email: "alin.l@crystal-logistics-services.com", mondayUserId: 73962695, department: DEPARTMENTS.MANAGEMENT, role: "manager", target: 3960, isActive: true },
  { name: "Bogdan Serafim", email: "bogdan.s@crystal-logistics-services.com", mondayUserId: 73962698, department: DEPARTMENTS.MANAGEMENT, role: "manager", target: 3780, isActive: true },
  { name: "Alexandru Paraschiv", email: "alexandru.p@crystal-logistics-services.com", mondayUserId: 74108550, department: DEPARTMENTS.SALES, role: "employee", target: 3300, isActive: true },
  { name: "Denisa Ionescu", email: "denisa.i@crystal-logistics-services.com", mondayUserId: 74108553, department: DEPARTMENTS.SALES, role: "employee", target: 2112, isActive: true },
  { name: "Andrei Pauna", email: "andrei.p@crystal-logistics-services.com", mondayUserId: 73046350, department: DEPARTMENTS.SALES, role: "employee", target: 3400, isActive: true },
  { name: "Nedelcu Alexandru", email: "alexandru.n@crystal-logistics-services.com", mondayUserId: 77987246, department: DEPARTMENTS.SALES, role: "employee", target: 3630, isActive: true },
  { name: "Christiana Sora", email: "christiana.s@crystal-logistics-services.com", mondayUserId: 90770132, department: DEPARTMENTS.SALES, role: "employee", target: 2310, isActive: true },
  { name: "Eduard Grigore", email: "eduard.g@crystal-logistics-services.com", mondayUserId: 96568397, department: DEPARTMENTS.SALES, role: "employee", target: 2100, isActive: true },
  { name: "George Rafte", email: "george.r@crystal-logistics-services.com", mondayUserId: 98357010, department: DEPARTMENTS.SALES, role: "employee", target: 2800, isActive: true },
  { name: "David Popescu", email: "david.p@crystal-logistics-services.com", mondayUserId: 74695692, department: DEPARTMENTS.OPERATIONS, role: "employee", target: 3485, isActive: true },
  { name: "Roberto Coica", email: "roberto.c@crystal-logistics-services.com", mondayUserId: 74668675, department: DEPARTMENTS.OPERATIONS, role: "employee", target: 3240, isActive: true },
  { name: "Dumitru Ionut", email: "ionut.d@crystal-logistics-services.com", mondayUserId: 74668676, department: DEPARTMENTS.OPERATIONS, role: "employee", target: 3240, isActive: true },
  { name: "Robert Florea", email: "robert.f@crystal-logistics-services.com", mondayUserId: 74668678, department: DEPARTMENTS.OPERATIONS, role: "employee", target: 4590, isActive: true },
  { name: "Alexandra Ghiurca", email: "alexandra.g@crystal-logistics-services.com", mondayUserId: 96280239, department: DEPARTMENTS.OPERATIONS, role: "employee", target: 3040, isActive: true },
  { name: "David Mitrica", email: "david.m@crystal-logistics-services.com", mondayUserId: 89227837, department: DEPARTMENTS.OPERATIONS, role: "employee", target: 1920, isActive: true },
  { name: "Mocanu George", email: "george.m@crystal-logistics-services.com", mondayUserId: 96568400, department: DEPARTMENTS.OPERATIONS, role: "employee", target: 3040, isActive: true },
];

export const MANAGERS = ORG.filter((p) => p.role === "manager" && p.isActive);
export const EMPLOYEES = ORG.filter((p) => p.isActive);

export const getByMondayUserId = (mondayUserId) =>
  ORG.find((p) => p.mondayUserId === Number(mondayUserId));

export const isManager = (mondayUserId) =>
  MANAGERS.some((m) => m.mondayUserId === Number(mondayUserId));
