import { SignJWT, jwtVerify } from "jose";

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(
  userId: string,
  secret: string,
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
    });
    // Sessão de admin não vale como sessão de aluno. Tokens antigos de aluno
    // não têm `typ` nenhum e continuam valendo — por isso a checagem é pela
    // presença do valor de admin, não pela ausência de um valor de aluno.
    if (payload.typ === "admin") return null;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * A sessão do painel. `sub` é o email (a chave de `admins`), e `typ` separa
 * este token do de aluno: os dois são assinados com o mesmo segredo e, em
 * desenvolvimento, convivem no mesmo localhost.
 *
 * Doze horas, contra os sete dias do aluno: sessão de painel administrativo
 * não deveria sobreviver a um fim de semana.
 */
export async function signAdminSession(
  email: string,
  secret: string,
): Promise<string> {
  return new SignJWT({ typ: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key(secret));
}

export async function verifyAdminSession(
  token: string,
  secret: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
    });
    if (payload.typ !== "admin") return null;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
