import { neon } from "@netlify/neon";

function ok(data, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(data),
  };
}

function fail(msg, statusCode = 400) {
  return ok({ error: msg }, statusCode);
}

// ---- SCHEMA SETUP ----

async function setup(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      email TEXT DEFAULT '',
      ifu TEXT DEFAULT '',
      vmcf TEXT DEFAULT '',
      paypal TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      siren TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      date DATE NOT NULL,
      company_id INTEGER REFERENCES companies(id),
      client_id INTEGER REFERENCES clients(id),
      conditions TEXT DEFAULT 'Paiement à réception',
      total_ttc DECIMAL(12,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT DEFAULT '',
      quantity DECIMAL(10,2),
      unit_price DECIMAL(10,2),
      amount DECIMAL(12,2) DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    )
  `;

  const companies = await sql`SELECT id FROM companies LIMIT 1`;
  if (companies.length === 0) {
    await sql`
      INSERT INTO companies (name, address, email, ifu, vmcf, paypal)
      VALUES (
        'CODKAGE DEVELOPPEMENT',
        'Ilot: C/SB, Gounin, Parakou Bénin',
        'adimiulrich06@gmail.com',
        '0202375331610',
        'EM01377197',
        'adimiulrich06@gmail.com'
      )
    `;
  }

  return ok({ ok: true, message: "Schema ready" });
}

// ---- COMPANIES ----

async function getCompanies(sql) {
  const rows = await sql`SELECT * FROM companies ORDER BY updated_at DESC`;
  return ok(rows);
}

async function saveCompany(sql, data) {
  if (data.id) {
    const rows = await sql`
      UPDATE companies SET
        name = ${data.name},
        address = ${data.address || ""},
        email = ${data.email || ""},
        ifu = ${data.ifu || ""},
        vmcf = ${data.vmcf || ""},
        paypal = ${data.paypal || ""},
        updated_at = NOW()
      WHERE id = ${data.id}
      RETURNING *
    `;
    return ok(rows[0]);
  } else {
    const rows = await sql`
      INSERT INTO companies (name, address, email, ifu, vmcf, paypal)
      VALUES (${data.name}, ${data.address || ""}, ${data.email || ""}, ${data.ifu || ""}, ${data.vmcf || ""}, ${data.paypal || ""})
      RETURNING *
    `;
    return ok(rows[0]);
  }
}

// ---- CLIENTS ----

async function upsertClient(sql, data) {
  if (!data.name || !data.name.trim()) return null;

  const existing = await sql`
    SELECT * FROM clients WHERE LOWER(name) = LOWER(${data.name.trim()}) LIMIT 1
  `;

  if (existing.length > 0) {
    const rows = await sql`
      UPDATE clients SET
        address = ${data.address || existing[0].address},
        city = ${data.city || existing[0].city},
        siren = ${data.siren || existing[0].siren}
      WHERE id = ${existing[0].id}
      RETURNING *
    `;
    return rows[0];
  } else {
    const rows = await sql`
      INSERT INTO clients (name, address, city, siren)
      VALUES (${data.name.trim()}, ${data.address || ""}, ${data.city || ""}, ${data.siren || ""})
      RETURNING *
    `;
    return rows[0];
  }
}

// ---- INVOICES ----

async function getInvoices(sql) {
  const rows = await sql`
    SELECT
      i.*,
      c.name as client_name, c.address as client_address, c.city as client_city, c.siren as client_siren,
      co.name as company_name
    FROM invoices i
    LEFT JOIN clients c ON i.client_id = c.id
    LEFT JOIN companies co ON i.company_id = co.id
    ORDER BY i.created_at DESC
  `;

  for (const inv of rows) {
    const items = await sql`
      SELECT * FROM invoice_items WHERE invoice_id = ${inv.id} ORDER BY sort_order ASC
    `;
    inv.items = items;
  }

  return ok(rows);
}

async function getInvoice(sql, id) {
  const rows = await sql`
    SELECT i.*,
      c.name as client_name, c.address as client_address, c.city as client_city, c.siren as client_siren,
      co.name as company_name, co.address as company_address, co.email as company_email,
      co.ifu as company_ifu, co.vmcf as company_vmcf, co.paypal as company_paypal
    FROM invoices i
    LEFT JOIN clients c ON i.client_id = c.id
    LEFT JOIN companies co ON i.company_id = co.id
    WHERE i.id = ${id}
  `;
  if (rows.length === 0) return fail("Not found", 404);

  const inv = rows[0];
  inv.items = await sql`
    SELECT * FROM invoice_items WHERE invoice_id = ${inv.id} ORDER BY sort_order ASC
  `;
  return ok(inv);
}

async function saveInvoice(sql, data) {
  let clientId = null;
  if (data.clientName && data.clientName.trim()) {
    const client = await upsertClient(sql, {
      name: data.clientName,
      address: data.clientAddress,
      city: data.clientCity,
      siren: data.clientSiren,
    });
    if (client) clientId = client.id;
  }

  let companyId = data.companyId || null;
  if (!companyId) {
    const companies = await sql`SELECT id FROM companies ORDER BY updated_at DESC LIMIT 1`;
    if (companies.length > 0) companyId = companies[0].id;
  }

  const totalTtc = (data.items || []).reduce((sum, item) => {
    return sum + (parseFloat(item.amount) || 0);
  }, 0);

  let invoiceId;
  if (data.id) {
    await sql`
      UPDATE invoices SET
        number = ${data.number},
        date = ${data.date},
        company_id = ${companyId},
        client_id = ${clientId},
        conditions = ${data.conditions || "Paiement à réception"},
        total_ttc = ${totalTtc}
      WHERE id = ${data.id}
    `;
    invoiceId = data.id;
    await sql`DELETE FROM invoice_items WHERE invoice_id = ${invoiceId}`;
  } else {
    const rows = await sql`
      INSERT INTO invoices (number, date, company_id, client_id, conditions, total_ttc)
      VALUES (${data.number}, ${data.date}, ${companyId}, ${clientId}, ${data.conditions || "Paiement à réception"}, ${totalTtc})
      RETURNING id
    `;
    invoiceId = rows[0].id;
  }

  const items = data.items || [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await sql`
      INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order)
      VALUES (
        ${invoiceId},
        ${item.description || ""},
        ${item.quantity ? parseFloat(item.quantity) : null},
        ${item.unitPrice ? parseFloat(item.unitPrice) : null},
        ${parseFloat(item.amount) || 0},
        ${i}
      )
    `;
  }

  return ok({ ok: true, id: invoiceId });
}

async function deleteInvoice(sql, id) {
  await sql`DELETE FROM invoices WHERE id = ${id}`;
  return ok({ ok: true });
}

// ---- SUGGESTIONS ----

async function getSuggestions(sql) {
  const clients = await sql`SELECT DISTINCT name FROM clients ORDER BY name`;
  const descriptions = await sql`SELECT DISTINCT description FROM invoice_items WHERE description != '' ORDER BY description`;
  const numbers = await sql`SELECT number FROM invoices ORDER BY created_at DESC LIMIT 1`;

  let nextNumber = "EM01377297-100";
  if (numbers.length > 0) {
    const last = numbers[0].number;
    const parts = last.split("-");
    if (parts.length === 2) {
      const num = parseInt(parts[1]) + 1;
      nextNumber = parts[0] + "-" + num;
    }
  }

  return ok({
    clients: clients.map((r) => r.name),
    descriptions: descriptions.map((r) => r.description),
    nextNumber,
  });
}

// ---- HANDLER (v1 format) ----

export const handler = async (event) => {
  try {
    const sql = neon();
    const params = event.queryStringParameters || {};
    const action = params.action;
    const id = params.id;
    const method = event.httpMethod;

    if (method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: "",
      };
    }

    if (method === "GET") {
      switch (action) {
        case "setup": return setup(sql);
        case "companies": return getCompanies(sql);
        case "clients": return getClients(sql);
        case "invoices": return getInvoices(sql);
        case "invoice": return getInvoice(sql, id);
        case "suggestions": return getSuggestions(sql);
        default: return fail("Unknown action: " + action);
      }
    }

    if (method === "POST") {
      const data = JSON.parse(event.body || "{}");
      switch (action) {
        case "save-company": return saveCompany(sql, data);
        case "save-invoice": return saveInvoice(sql, data);
        default: return fail("Unknown action: " + action);
      }
    }

    if (method === "DELETE") {
      if (action === "delete-invoice") return deleteInvoice(sql, id);
      return fail("Unknown action");
    }

    return fail("Method not allowed", 405);
  } catch (e) {
    console.error("API Error:", e);
    return ok({ error: e.message }, 500);
  }
};
