// Admin PDF reports. Every report is built here from the saved orders and
// customers, never from data sent by the browser, so the numbers in a PDF
// cannot be changed before it is generated. Each PDF gets a report number and
// a SHA-256 fingerprint of its data; both are saved so a printed copy can be
// checked later with ?verify=<report number>.
const crypto = require('crypto');
const { connectLambda, getStore } = require('@netlify/blobs');
const { authenticateEvent } = require('./lib/auth');
const { readAllOrderRecords, normalizeEmail } = require('./lib/customer-data');
const { PdfReport } = require('./lib/pdf');
const { getPaymentSummary, summarizeCustomerPayments, STANDINGS } = require('../../js/payment-summary');
const { listCustomers } = require('./customers');

const TIME_ZONE = 'Asia/Manila';
const PH_OFFSET = '+08:00';
const REGISTER_STORE = 'kingpin-report-register';

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

function peso(value) {
    return `PHP ${(Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function amount(value) {
    return (Number(value) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(date) {
    return date ? date.toLocaleDateString('en-PH', { timeZone: TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

function formatDateTime(date) {
    return date.toLocaleString('en-PH', { timeZone: TIME_ZONE, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Order ids are the time the order was placed; older orders may only have a date string.
function placedDate(order) {
    const idTime = Number(order?.id);
    if (Number.isFinite(idTime) && idTime > 946684800000 && idTime < 4102444800000) return new Date(idTime);
    const parsed = new Date(order?.date);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function phDayStart(isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return null;
    const date = new Date(`${isoDate}T00:00:00${PH_OFFSET}`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function statusText(order) {
    return String(order.status || 'pending').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function productsText(order) {
    return (order.items || []).map(item => `${item.name || 'Item'} (x${Number(item.quantity) || 1})`).join(', ') || 'N/A';
}

function isSoldOrder(order) {
    return String(order.status || '').toLowerCase() !== 'cancelled'
        && String(order.productionStatus || '').toLowerCase() !== 'cancelled'
        && String(order.paymentStatus || '').toLowerCase() !== 'rejected';
}

function isHistoryOrder(order) {
    const status = String(order.status || '').toLowerCase();
    const production = String(order.productionStatus || '').toLowerCase();
    return ['completed', 'delivered', 'cancelled'].includes(status) || ['completed', 'cancelled'].includes(production);
}

function byPlacedDate(first, second) {
    return (placedDate(first)?.getTime() || 0) - (placedDate(second)?.getTime() || 0);
}

// Same rules as the Sales & Reports screen: orders placed in the period that
// were not cancelled and whose payment was not rejected.
function buildSalesReport(orders, params) {
    const start = phDayStart(params.start);
    const endDay = phDayStart(params.end);
    const end = endDay ? new Date(endDay.getTime() + 24 * 60 * 60 * 1000) : null;
    if ((params.start && !start) || (params.end && !endDay) || (start && end && start >= end)) return { error: 'Choose a valid report period.' };
    const sold = orders
        .filter(isSoldOrder)
        .filter(order => {
            const date = placedDate(order);
            if (!start && !end) return true;
            return date && (!start || date >= start) && (!end || date < end);
        })
        .sort(byPlacedDate);
    const totalSales = sold.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
    const customers = new Set(sold.map(order => normalizeEmail(order.customerEmail))).size;
    const period = start || end
        ? `${start ? formatDate(start) : 'Beginning'} - ${endDay ? formatDate(endDay) : 'today'}`
        : 'All recorded dates';
    return {
        title: 'Sales & Performance Report',
        period,
        summary: [
            ['Total Sales', peso(totalSales)],
            ['Total Orders', String(sold.length)],
            ['Unique Customers', String(customers)],
            ['Average Order Value', peso(sold.length ? totalSales / sold.length : 0)]
        ],
        sections: [{
            heading: 'Sales Order Details',
            columns: [
                { header: 'Order ID', width: 1.3 },
                { header: 'Customer Name', width: 1.5 },
                { header: 'Email', width: 2 },
                { header: 'Products', width: 3 },
                { header: 'Total Amount (PHP)', width: 1.2, align: 'right' },
                { header: 'Status', width: 1.2 },
                { header: 'Date', width: 1.1 }
            ],
            rows: sold.map(order => [`#${order.id}`, order.customerName || 'N/A', order.customerEmail || 'N/A', productsText(order), amount(order.totalAmount), statusText(order), formatDate(placedDate(order)) || order.date || 'N/A']),
            emptyText: 'No sales in this period.'
        }],
        rowCount: sold.length
    };
}

function buildCustomerReport(customers, orders, params) {
    const ordersByEmail = new Map();
    orders.forEach(order => {
        const email = normalizeEmail(order.customerEmail);
        if (!email) return;
        if (!ordersByEmail.has(email)) ordersByEmail.set(email, []);
        ordersByEmail.get(email).push(order);
    });
    const standing = String(params.standing || 'all');
    const search = String(params.search || '').trim().toLowerCase();
    const selected = customers
        .filter(customer => customer.status !== 'old-email')
        .map(customer => {
            const own = (ordersByEmail.get(normalizeEmail(customer.accountEmail || customer.email)) || []).slice().sort((a, b) => byPlacedDate(b, a));
            return { customer, orders: own, payment: summarizeCustomerPayments(own) };
        })
        .filter(entry => standing === 'all' || entry.payment.standing === standing)
        .filter(entry => !search || `${entry.customer.name} ${entry.customer.email}`.toLowerCase().includes(search));

    const totals = selected.reduce((sum, entry) => ({
        orders: sum.orders + entry.orders.length,
        amount: sum.amount + entry.payment.totalAmount,
        paid: sum.paid + entry.payment.amountPaid,
        balance: sum.balance + entry.payment.balance
    }), { orders: 0, amount: 0, paid: 0, balance: 0 });

    const detailRows = [];
    selected.forEach(({ customer, orders: own, payment }) => {
        detailRows.push({ group: `${customer.name}  -  ${customer.email}${customer.phone ? `  -  ${customer.phone}` : ''}` });
        if (!own.length) detailRows.push(['', '', 'No orders yet.', '', '', '', '']);
        own.forEach(order => {
            const summary = getPaymentSummary(order);
            detailRows.push([`#${order.id}`, formatDate(placedDate(order)) || order.date || '', productsText(order), amount(summary.total), amount(summary.amountPaid), amount(summary.balance), `${statusText(order)} / ${summary.label}`]);
        });
        if (own.length) detailRows.push({ subtotal: true, cells: [`Total for ${customer.name}`, '', `${own.length} order${own.length === 1 ? '' : 's'}`, amount(payment.totalAmount), amount(payment.amountPaid), amount(payment.balance), payment.label] });
    });

    const filterParts = [];
    if (standing !== 'all') filterParts.push(`Payment status: ${STANDINGS[standing] || standing}`);
    if (search) filterParts.push(`Search: "${search}"`);
    return {
        title: 'Customer Orders & Balances Report',
        period: filterParts.length ? filterParts.join('; ') : 'All customers',
        summary: [
            ['Customers', String(selected.length)],
            ['Orders', String(totals.orders)],
            ['Total Amount', peso(totals.amount)],
            ['Total Paid', peso(totals.paid)],
            ['Balance to Collect', peso(totals.balance)]
        ],
        sections: [{
            heading: 'Customer Summary',
            columns: [
                { header: 'Name', width: 1.6 },
                { header: 'Email', width: 2.1 },
                { header: 'Phone', width: 1.2 },
                { header: 'Orders', width: 0.7, align: 'right' },
                { header: 'Total (PHP)', width: 1.1, align: 'right' },
                { header: 'Paid (PHP)', width: 1.1, align: 'right' },
                { header: 'Balance (PHP)', width: 1.1, align: 'right' },
                { header: 'Payment Status', width: 1.6 },
                { header: 'Last Order', width: 1.1 }
            ],
            rows: selected.map(({ customer, orders: own, payment }) => [customer.name, customer.email, customer.phone || 'Not provided', String(own.length), amount(payment.totalAmount), amount(payment.amountPaid), amount(payment.balance), payment.label, own[0] ? formatDate(placedDate(own[0])) : 'No orders yet']),
            emptyText: 'No customers match this filter.'
        }, {
            heading: 'Orders per Customer',
            columns: [
                { header: 'Order #', width: 1.2 },
                { header: 'Date', width: 1 },
                { header: 'Products', width: 3 },
                { header: 'Total (PHP)', width: 1, align: 'right' },
                { header: 'Paid (PHP)', width: 1, align: 'right' },
                { header: 'Balance (PHP)', width: 1, align: 'right' },
                { header: 'Status', width: 2.2 }
            ],
            rows: detailRows,
            emptyText: 'No orders.'
        }],
        rowCount: selected.length
    };
}

function buildHistoryReport(orders, params) {
    const year = /^\d{4}$/.test(String(params.year || '')) ? String(params.year) : '';
    const month = /^(0[1-9]|1[0-2])$/.test(String(params.month || '')) ? String(params.month) : '';
    const search = String(params.search || '').trim().toLowerCase();
    const parts = date => {
        if (!date) return {};
        const [y, m] = date.toLocaleDateString('en-CA', { timeZone: TIME_ZONE }).split('-');
        return { y, m };
    };
    const rows = orders
        .filter(isHistoryOrder)
        .filter(order => {
            const { y, m } = parts(placedDate(order));
            return (!year || y === year) && (!month || m === month);
        })
        .filter(order => !search || `${order.id} ${order.customerName || ''} ${order.customerEmail || ''}`.toLowerCase().includes(search))
        .sort((a, b) => byPlacedDate(b, a));
    const completed = rows.filter(order => !['cancelled'].includes(String(order.status || '').toLowerCase()) && String(order.productionStatus || '').toLowerCase() !== 'cancelled');
    const monthName = month ? new Date(2000, Number(month) - 1, 1).toLocaleString('en-PH', { month: 'long' }) : '';
    const filterParts = [year || monthName ? `${monthName ? `${monthName} ` : 'All months of '}${year || 'all years'}` : 'All years and months'];
    if (search) filterParts.push(`Search: "${search}"`);
    return {
        title: 'Purchase History Report',
        period: filterParts.join('; '),
        summary: [
            ['Orders', String(rows.length)],
            ['Completed', String(completed.length)],
            ['Cancelled', String(rows.length - completed.length)],
            ['Completed Amount', peso(completed.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0))]
        ],
        sections: [{
            heading: 'Completed and Cancelled Orders',
            columns: [
                { header: 'Order ID', width: 1.3 },
                { header: 'Customer Name', width: 1.4 },
                { header: 'Email', width: 1.9 },
                { header: 'Products', width: 2.4 },
                { header: 'Total (PHP)', width: 1, align: 'right' },
                { header: 'Status', width: 1 },
                { header: 'Order Date', width: 1 },
                { header: 'Delivery Address', width: 2 }
            ],
            rows: rows.map(order => [`#${order.id}`, order.customerName || 'N/A', order.customerEmail || 'N/A', productsText(order), amount(order.totalAmount), statusText(order), formatDate(placedDate(order)) || order.date || 'N/A', order.customerAddress || 'N/A']),
            emptyText: 'No completed or cancelled orders match this filter.'
        }],
        rowCount: rows.length
    };
}

function reportNumber(now) {
    const stamp = now.toLocaleString('sv-SE', { timeZone: TIME_ZONE }).replace(/[-: ]/g, '');
    return `RPT-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function renderPdf(report, meta) {
    const pdf = new PdfReport({ title: report.title, subtitle: report.period });
    pdf.header([
        ['Report No.', meta.reportNo],
        ['Generated', `${formatDateTime(meta.generatedAt)} (Philippine time) by ${meta.generatedBy}`],
        ['Source', 'Saved system records at the time of generation']
    ]);
    pdf.summary(report.summary);
    report.sections.forEach(section => {
        pdf.heading(section.heading);
        pdf.table(section.columns, section.rows, { emptyText: section.emptyText });
    });
    pdf.note(`This report was generated by the KingPin system directly from saved records and cannot be edited before download. To confirm a printed copy is genuine, open Admin > Reports > Verify a report and enter ${meta.reportNo}; the fingerprint below must match.`);
    return pdf.toBuffer({
        info: { Title: `${report.title} ${meta.reportNo}`, Author: 'KingPin Custom PH system', Producer: 'KingPin reports', Subject: report.period },
        footer: () => [
            `${report.title}  |  Report No. ${meta.reportNo}  |  Generated ${formatDateTime(meta.generatedAt)}`,
            `Data fingerprint (SHA-256): ${meta.fingerprint}`
        ]
    });
}

exports.handler = async event => {
    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
    const auth = authenticateEvent(event);
    if (!auth.ok) return json(auth.statusCode, { error: auth.error });
    if (auth.claims.role !== 'admin') return json(403, { error: 'Admin access required.' });

    try {
        connectLambda(event);
        const params = event.queryStringParameters || {};
        const register = getStore(REGISTER_STORE);

        if (params.verify !== undefined) {
            const reportNo = String(params.verify || '').trim().toUpperCase();
            if (!/^RPT-\d{8}-\d{6}-[0-9A-F]{4}$/.test(reportNo)) return json(400, { error: 'Enter a report number like RPT-20261112-153000-AB12.' });
            const saved = await register.get(`report-${reportNo}`, { type: 'json' });
            return json(200, saved ? { found: true, report: saved } : { found: false });
        }

        const type = String(params.type || 'sales');
        const { orders } = await readAllOrderRecords(getStore('kingpin-order-index'), getStore('kingpin-orders'));
        let report;
        if (type === 'sales') report = buildSalesReport(orders, params);
        else if (type === 'customers') report = buildCustomerReport(await listCustomers(), orders, params);
        else if (type === 'history') report = buildHistoryReport(orders, params);
        else return json(400, { error: 'Unknown report type.' });
        if (report.error) return json(400, { error: report.error });

        const generatedAt = new Date();
        const reportNo = reportNumber(generatedAt);
        const fingerprint = crypto.createHash('sha256')
            .update(JSON.stringify({ type, period: report.period, summary: report.summary, sections: report.sections.map(section => section.rows) }))
            .digest('hex');
        const meta = { reportNo, generatedAt, generatedBy: String(auth.claims.sub), fingerprint };
        await register.setJSON(`report-${reportNo}`, {
            reportNo,
            type,
            title: report.title,
            period: report.period,
            generatedAt: generatedAt.toISOString(),
            generatedBy: meta.generatedBy,
            rowCount: report.rowCount,
            summary: report.summary,
            fingerprint
        });

        const pdf = renderPdf(report, meta);
        const fileName = `KINGPIN-${report.title.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '')}-${reportNo}.pdf`;
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Cache-Control': 'no-store',
                'X-Report-Number': reportNo,
                'Access-Control-Expose-Headers': 'X-Report-Number, Content-Disposition'
            },
            isBase64Encoded: true,
            body: pdf.toString('base64')
        };
    } catch (error) {
        console.error('Report generation failed:', error);
        return json(500, { error: 'Unable to generate the report. Please try again.' });
    }
};

exports._test = { buildSalesReport, buildCustomerReport, buildHistoryReport, placedDate };
