import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function amountToWords(n: number): string {
  if (n <= 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
    "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
    "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function convert(num: number): string {
    if (num < 20)      return ones[num];
    if (num < 100)     return tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
    if (num < 1000)    return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " and " + convert(num % 100) : "");
    if (num < 100000)  return convert(Math.floor(num / 1000)) + " Thousand" + (num % 1000 ? " " + convert(num % 1000) : "");
    if (num < 10000000) return convert(Math.floor(num / 100000)) + " Lakh" + (num % 100000 ? " " + convert(num % 100000) : "");
    return convert(Math.floor(num / 10000000)) + " Crore" + (num % 10000000 ? " " + convert(num % 10000000) : "");
  }
  return "Rupees " + convert(Math.abs(Math.round(n))) + " Only";
}

const fmtInr = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const monthName = (m: number) =>
  ["January","February","March","April","May","June",
   "July","August","September","October","November","December"][m - 1];

// ─────────────────────────────────────────────
//  PDF Generator
// ─────────────────────────────────────────────
export async function generatePayslipPdf(
  payslip: Record<string, any>,
  settings: { company_name: string; company_address: string; logo_path: string | null },
  year: number,
  month: number
): Promise<Buffer> {

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W = 210;   // A4 width mm
  const marginX = 14;
  const contentW = W - marginX * 2;

  // ── Colours ──────────────────────────────────
  const NAVY       = [15,  23,  42] as [number, number, number];
  const INDIGO     = [79,  70, 229] as [number, number, number];
  const INDIGO_LIGHT = [238, 242, 255] as [number, number, number];
  const GREEN      = [5, 150, 105] as [number, number, number];
  const GREEN_LIGHT = [236, 253, 245] as [number, number, number];
  const RED        = [220,  38,  38] as [number, number, number];
  const RED_LIGHT  = [254, 242, 242] as [number, number, number];
  const SLATE_50   = [248, 250, 252] as [number, number, number];
  const SLATE_200  = [226, 232, 240] as [number, number, number];
  const SLATE_400  = [148, 163, 184] as [number, number, number];
  const WHITE      = [255, 255, 255] as [number, number, number];
  const BLACK      = [15,  23,  42] as [number, number, number];

  let y = 0;

  // ── HEADER BAND ───────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 38, "F");

  // Logo (if available)
  let logoX = marginX;
  const logoH = 14;
  const logoW = 28;
  const logoY = 12;
  if (settings.logo_path) {
    try {
      const logoFile = path.join(process.cwd(), "public", settings.logo_path);
      if (fs.existsSync(logoFile)) {
        const imgData = fs.readFileSync(logoFile);
        const b64 = imgData.toString("base64");
        const ext = path.extname(settings.logo_path).toLowerCase().replace(".", "");
        const imgFormat = ext === "jpg" ? "JPEG" : "PNG";
        doc.addImage(b64, imgFormat, logoX, logoY, logoW, logoH);
        logoX += logoW + 4;
      }
    } catch { /* skip logo on error */ }
  } else {
    // Placeholder box
    doc.setFillColor(...INDIGO);
    doc.roundedRect(logoX, logoY, 14, 14, 2, 2, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    const initials = settings.company_name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
    doc.text(initials, logoX + 7, logoY + 9.5, { align: "center" });
    logoX += 18;
  }

  // Company name + address (left)
  doc.setTextColor(...WHITE);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(settings.company_name, logoX, 18);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 190, 210);
  const addressLines = (settings.company_address || "").replace(/\\n/g, "\n").split("\n");
  doc.text(addressLines, logoX, 23.5);

  // "SALARY SLIP" (right)
  doc.setTextColor(...WHITE);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("SALARY SLIP", W - marginX, 18, { align: "right" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 190, 210);
  doc.text(`For the month of ${monthName(month)} ${year}`, W - marginX, 24, { align: "right" });

  y = 44;

  // ── EMPLOYEE INFO TABLE ───────────────────────
  const empName     = payslip.emp_name   || "";
  const empCode     = (payslip.emp_code  || "").toUpperCase();
  const dept        = payslip.department  || "—";
  const designation = payslip.designation || "—";
  const stdHours    = Number(payslip.standard_hours || 0);
  const hoursLogged = Number(payslip.hours_logged   || 0);
  const leaveBal    = Number(payslip.leave_balance_snap ?? payslip.leave_balance ?? 0);
  const paidLeaves  = Number(payslip.paid_leaves || 0);

  // Info grid — 4-column label/value
  const infoData = [
    ["Employee Name", empName, "Employee ID", empCode],
    ["Designation",   designation, "Department", dept],
    ["Expected Hours", `${stdHours}h`, "Hours Logged", `${hoursLogged}h`],
    ["Paid Leaves Applied", `${paidLeaves}`, "Leave Balance", `${leaveBal}`],
  ];

  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    tableWidth: contentW,
    body: infoData,
    theme: "plain",
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
    },
    columnStyles: {
      0: { textColor: SLATE_400, fontStyle: "normal", cellWidth: contentW * 0.18 },
      1: { textColor: BLACK,     fontStyle: "bold",   cellWidth: contentW * 0.32 },
      2: { textColor: SLATE_400, fontStyle: "normal", cellWidth: contentW * 0.18 },
      3: { textColor: BLACK,     fontStyle: "bold",   cellWidth: contentW * 0.32 },
    },
    didDrawPage: () => {},
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  // Divider
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, W - marginX, y);
  y += 6;

  // ── FINANCIAL LEDGER (2-column) ───────────────
  const baseSalary     = Number(payslip.base_salary     || 0);
  const otHours        = Number(payslip.ot_hours        || 0);
  const otPay          = Number(payslip.ot_pay          || 0);
  const bonus          = Number(payslip.bonus           || 0);
  const grossEarnings  = Number(payslip.gross_earnings  || baseSalary + otPay + bonus);

  const shortDed       = Number(payslip.short_deduction || 0);
  const advTaken       = Number(payslip.advances_taken  || 0);
  const profTax        = Number(payslip.professional_tax || 0);
  const fines          = Number(payslip.fines           || 0);
  const totalDed       = Number(payslip.total_deductions || shortDed + advTaken + profTax + fines);
  const netPayable     = Number(payslip.net_payable     || grossEarnings - totalDed);

  const colW = (contentW - 4) / 2;

  // Earnings header
  doc.setFillColor(...INDIGO_LIGHT);
  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.3);
  doc.rect(marginX, y, colW, 7, "FD");
  doc.setTextColor(...INDIGO);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("EARNINGS", marginX + 4, y + 4.8);

  // Deductions header
  doc.setFillColor(...RED_LIGHT);
  doc.rect(marginX + colW + 4, y, colW, 7, "FD");
  doc.setTextColor(...RED);
  doc.text("DEDUCTIONS", marginX + colW + 8, y + 4.8);
  y += 7;

  // Earnings rows
  const earningRows: [string, number][] = [
    [`Basic Salary (for ${stdHours}h)`, baseSalary],
    [`Overtime Pay (${otHours}h)`,      otPay],
    ["Bonus / Incentive",               bonus],
  ].filter(([, v]) => (v as number) >= 0) as [string, number][];

  // Deduction rows
  const deductRows: [string, number][] = [
    ["Shortfall / Leave Penalty", shortDed],
    ["Advance Recovery",          advTaken],
    ["Professional Tax",          profTax],
    ["Other Fines",               fines],
  ].filter(([, v]) => (v as number) >= 0) as [string, number][];

  const maxRows = Math.max(earningRows.length, deductRows.length);

  const rowH = 7;
  for (let i = 0; i < maxRows; i++) {
    const stripe = i % 2 === 0 ? SLATE_50 : WHITE;

    // Earning side
    doc.setFillColor(...stripe);
    doc.rect(marginX, y, colW, rowH, "F");
    if (earningRows[i]) {
      doc.setTextColor(...BLACK);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(earningRows[i][0], marginX + 4, y + 4.8);
      doc.setFont("helvetica", "bold");
      doc.text(fmtInr(earningRows[i][1]), marginX + colW - 4, y + 4.8, { align: "right" });
    }

    // Deduction side
    doc.setFillColor(...stripe);
    doc.rect(marginX + colW + 4, y, colW, rowH, "F");
    if (deductRows[i]) {
      doc.setTextColor(...BLACK);
      doc.setFont("helvetica", "normal");
      doc.text(deductRows[i][0], marginX + colW + 8, y + 4.8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...RED);
      doc.text(fmtInr(deductRows[i][1]), marginX + contentW - 4, y + 4.8, { align: "right" });
    }
    y += rowH;
  }

  // Totals row
  // Gross Earnings
  doc.setFillColor(...GREEN_LIGHT);
  doc.rect(marginX, y, colW, 8, "F");
  doc.setTextColor(...GREEN);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.text("Gross Earnings", marginX + 4, y + 5.5);
  doc.text(fmtInr(grossEarnings), marginX + colW - 4, y + 5.5, { align: "right" });

  // Total Deductions
  doc.setFillColor(...RED_LIGHT);
  doc.rect(marginX + colW + 4, y, colW, 8, "F");
  doc.setTextColor(...RED);
  doc.text("Total Deductions", marginX + colW + 8, y + 5.5);
  doc.text(fmtInr(totalDed), marginX + contentW - 4, y + 5.5, { align: "right" });
  y += 8 + 6;

  // ── NET PAYABLE BAND ──────────────────────────
  doc.setFillColor(...NAVY);
  doc.roundedRect(marginX, y, contentW, 20, 3, 3, "F");

  doc.setTextColor(148, 163, 220);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text("NET SALARY PAYABLE", marginX + 6, y + 8);

  doc.setTextColor(...WHITE);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(fmtInr(netPayable), W - marginX - 6, y + 13, { align: "right" });
  y += 20 + 3;

  // In words
  doc.setFillColor(...SLATE_50);
  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.3);
  doc.rect(marginX, y, contentW, 8, "FD");
  doc.setTextColor(...SLATE_400);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "italic");
  const wordLine = `( ${amountToWords(netPayable)} )`;
  doc.text(wordLine, marginX + contentW / 2, y + 5, { align: "center" });
  y += 8 + 14;

  // ── SIGNATURES ────────────────────────────────
  doc.setDrawColor(...SLATE_400);
  doc.setLineWidth(0.4);
  const sigW = 50;
  (doc as any).setLineDash([1.5, 1.5], 0);
  doc.line(marginX, y, marginX + sigW, y);
  doc.line(W - marginX - sigW, y, W - marginX, y);
  (doc as any).setLineDash([]);
  doc.setFontSize(7.5);
  doc.setTextColor(...SLATE_400);
  doc.setFont("helvetica", "normal");
  doc.text("Authorised Signatory", marginX + sigW / 2, y + 4.5, { align: "center" });
  doc.text("Employee Signature", W - marginX - sigW / 2, y + 4.5, { align: "center" });
  y += 16;

  // ── FOOTER ───────────────────────────────────
  doc.setFillColor(...SLATE_50);
  doc.rect(0, y, W, 12, "F");
  doc.setFontSize(7);
  doc.setTextColor(...SLATE_400);
  doc.setFont("helvetica", "italic");
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  doc.text(
    `This is a system-generated document. Generated on ${today}. | ${settings.company_name}`,
    W / 2, y + 7, { align: "center" }
  );

  // Return as Buffer
  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
