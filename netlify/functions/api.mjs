import { neon } from "@netlify/neon";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
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

  // Seed default company if none exists
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

  return json({ ok: true, message: "Schema ready" });
}

// ---- COMPANIES ----

async function getCompanies(sql) {
  const rows = await sql`SELECT * FROM companies ORDER BY updated_at DESC`;
  return json(rows);
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
    return json(rows[0]);
  } else {
    const rows = await sql`
      INSERT INTO companies (name, address, email, ifu, vmcf, paypal)
      VALUES (${data.name}, ${data.address || ""}, ${data.email || ""}, ${data.ifu || ""}, ${data.vmcf || ""}, ${data.paypal || ""})
      RETURNING *
    `;
    return json(rows[0]);
  }
}

// ---- CLIENTS ----

async function getClients(sql) {
  const rows = await sql`SELECT * FROM clients ORDER BY name ASC`;
  return json(rows);
}

async function upsertClient(sql, data) {
  if (!data.name || !data.name.trim()) return null;

  // Try to find existing client by name
  const existing = await sql`
    SELECT * FROM clients WHERE LOWER(name) = LOWER(${data.name.trim()}) LIMIT 1
  `;

  if (existing.length > 0) {
    // Update if address/city changed
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
      c.name as client_name, c.address as client_address, c.city as client_city,
      co.name as company_name
    FROM invoices i
    LEFT JOIN clients c ON i.client_id = c.id
    LEFT JOIN companies co ON i.company_id = co.id
    ORDER BY i.created_at DESC
  `;

  // Fetch items for each invoice
  for (const inv of rows) {
    const items = await sql`
      SELECT * FROM invoice_items WHERE invoice_id = ${inv.id} ORDER BY sort_order ASC
    `;
    inv.items = items;
  }

  return json(rows);
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
  if (rows.length === 0) return err("Not found", 404);

  const inv = rows[0];
  inv.items = await sql`
    SELECT * FROM invoice_items WHERE invoice_id = ${inv.id} ORDER BY sort_order ASC
  `;
  return json(inv);
}

async function saveInvoice(sql, data) {
  // 1. Upsert client
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

  // 2. Get company
  let companyId = data.companyId || null;
  if (!companyId) {
    const companies = await sql`SELECT id FROM companies ORDER BY updated_at DESC LIMIT 1`;
    if (companies.length > 0) companyId = companies[0].id;
  }

  // 3. Compute total
  const totalTtc = (data.items || []).reduce((sum, item) => {
    return sum + (parseFloat(item.amount) || 0);
  }, 0);

  // 4. Insert or update invoice
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
    // Delete old items
    await sql`DELETE FROM invoice_items WHERE invoice_id = ${invoiceId}`;
  } else {
    const rows = await sql`
      INSERT INTO invoices (number, date, company_id, client_id, conditions, total_ttc)
      VALUES (${data.number}, ${data.date}, ${companyId}, ${clientId}, ${data.conditions || "Paiement à réception"}, ${totalTtc})
      RETURNING id
    `;
    invoiceId = rows[0].id;
  }

  // 5. Insert items
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

  return json({ ok: true, id: invoiceId });
}

async function deleteInvoice(sql, id) {
  await sql`DELETE FROM invoices WHERE id = ${id}`;
  return json({ ok: true });
}

// ---- SUGGESTIONS ----

async function getSuggestions(sql) {
  const clients = await sql`SELECT DISTINCT name FROM clients ORDER BY name`;
  const descriptions = await sql`SELECT DISTINCT description FROM invoice_items WHERE description != '' ORDER BY description`;
  const numbers = await sql`SELECT number FROM invoices ORDER BY created_at DESC LIMIT 1`;

  // Suggest next invoice number
  let nextNumber = "EM01377297-100";
  if (numbers.length > 0) {
    const last = numbers[0].number;
    const parts = last.split("-");
    if (parts.length === 2) {
      const num = parseInt(parts[1]) + 1;
      nextNumber = parts[0] + "-" + num;
    }
  }

  return json({
    clients: clients.map((r) => r.name),
    descriptions: descriptions.map((r) => r.description),
    nextNumber,
  });
}

// ---- HANDLER ----

export default async function handler(req) {
  try {
    const sql = neon();
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const id = url.searchParams.get("id");

    // GET actions
    if (req.method === "GET") {
      switch (action) {
        case "setup":
          return setup(sql);
        case "companies":
          return getCompanies(sql);
        case "clients":
          return getClients(sql);
        case "invoices":
          return getInvoices(sql);
        case "invoice":
          return getInvoice(sql, id);
        case "suggestions":
          return getSuggestions(sql);
        default:
          return err("Unknown action: " + action);
      }
    }

    // POST actions
    if (req.method === "POST") {
      const data = await req.json();
      switch (action) {
        case "save-company":
          return saveCompany(sql, data);
        case "save-invoice":
          return saveInvoice(sql, data);
        default:
          return err("Unknown action: " + action);
      }
    }

    // DELETE
    if (req.method === "DELETE") {
      if (action === "delete-invoice") {
        return deleteInvoice(sql, id);
      }
      return err("Unknown action");
    }

    return err("Method not allowed", 405);
  } catch (e) {
    console.error("API Error:", e);
    return json({ error: e.message }, 500);
  }
}

export const config = {
  path: "/.netlify/functions/api",
};
