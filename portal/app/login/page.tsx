import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getConfig } from "@/lib/config";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export default async function LoginPage() {
  const store = await cookies();
  const session = await verifySession(
    store.get(SESSION_COOKIE)?.value,
    getConfig().SESSION_SECRET,
  );
  if (session) {
    redirect("/");
  }

  return (
    <main className="login-screen">
      <LoginForm />
    </main>
  );
}
