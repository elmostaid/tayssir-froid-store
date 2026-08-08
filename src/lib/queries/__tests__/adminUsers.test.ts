import { afterAll, describe, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { listAdminAccounts, countActiveAdmins } from "@/lib/queries/adminUsers";

const fixtureIds: string[] = [];

async function createFixture(role: "admin" | "staff", disabled = false): Promise<string> {
  const id = randomUUID();
  const email = `list-fixture-${id}@example.com`;
  await sql`insert into auth.users (id, email) values (${id}, ${email})`;
  await sql`
    insert into public.admin_profiles (id, full_name, role, disabled_at)
    values (${id}, 'حساب قائمة اختبار', ${role}, ${disabled ? sql`now()` : null})
  `;
  fixtureIds.push(id);
  return id;
}

afterAll(async () => {
  for (const id of fixtureIds) {
    await sql`delete from public.admin_profiles where id = ${id}`;
    await sql`delete from auth.users where id = ${id}`;
  }
});

describe("listAdminAccounts", () => {
  test("يُرجع role وdisabledAt بشكل صحيح، وemail=null بأمان بدون service role", async () => {
    const activeId = await createFixture("staff");
    const disabledId = await createFixture("admin", true);

    const accounts = await listAdminAccounts();

    const active = accounts.find((a) => a.id === activeId);
    const disabled = accounts.find((a) => a.id === disabledId);

    expect(active).toBeDefined();
    expect(active?.role).toBe("staff");
    expect(active?.disabledAt).toBeNull();
    // بدون SUPABASE_SERVICE_ROLE_KEY (حال بيئة الاختبار) البريد null بأمان،
    // بلا أي انهيار.
    expect(active?.email).toBeNull();

    expect(disabled).toBeDefined();
    expect(disabled?.role).toBe("admin");
    expect(disabled?.disabledAt).not.toBeNull();
  });
});

describe("countActiveAdmins", () => {
  test("لا يحتسب admin معطَّلاً ولا staff", async () => {
    const before = await countActiveAdmins();

    await createFixture("admin");
    await createFixture("admin", true); // معطَّل — لا يُحتسَب
    await createFixture("staff"); // staff — لا يُحتسَب

    const after = await countActiveAdmins();
    expect(after).toBe(before + 1);
  });
});
