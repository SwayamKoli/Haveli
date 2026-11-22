/**
 * What counts as an acceptable password. The server enforces it (for employees when the owner saves them, and for
 * the owner password when it starts); the website shows the same message early. Pure functions, no dependencies.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 100;
/** On the internet the owner password must be longer: a few words are easier to remember than symbols. */
export const OWNER_PASSWORD_MIN_PUBLIC = 12;

/** The passwords attackers try first. Matched ignoring case and any digits or symbols added at the end. */
const COMMON = new Set([
  'password', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'letmein', 'welcome', 'qwerty', 'qwertyuiop', 'qwerty123', 'asdfghjkl', 'zxcvbnm',
  'iloveyou', 'admin', 'administrator', 'root', 'login', 'master', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'cricket',
  'abc123', 'abcd1234', 'changeme', 'default', 'secret', 'hotel', 'hotelhotel', 'reception', 'frontdesk', 'manager', 'owner', 'staff',
  'guest', 'india', 'mumbai', 'delhi', 'bollywood', 'krishna', 'ganesh', 'shivaji', 'jaishreeram', 'omnamahshivaya', 'trustno1',
  'superman', 'batman', 'shadow', 'michael', 'jordan', 'harley', 'hunter', 'whatever', 'freedom', 'starwars', 'computer', 'internet',
  'haveli', 'havelipassword', 'haveli123',
]);

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '0123456789', 'abcdefghijklmnopqrstuvwxyz'];

function isKeyboardRun(p: string): boolean {
  const s = p.toLowerCase();
  return ROWS.some((row) => {
    const rev = [...row].reverse().join('');
    return s.length >= 6 && (row.includes(s) || rev.includes(s));
  });
}

/** Returns what is wrong with the password in one friendly sentence, or null when it is acceptable. */
export function passwordProblem(password: string, ...avoid: string[]): string | null {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`;
  const lower = password.toLowerCase();
  const stem = lower.replace(/[0-9!@#$%^&*._-]+$/, '');
  if (COMMON.has(lower) || COMMON.has(stem)) return 'That password is too easy to guess. Try a few unrelated words.';
  if (new Set(lower).size <= 2) return 'That password is too repetitive. Try a few unrelated words.';
  if (isKeyboardRun(password) || isKeyboardRun(stem)) return 'That password is a keyboard pattern. Try a few unrelated words.';
  // The username and each word of the person's name (3 letters or more) must not appear inside the password.
  for (const a of avoid) {
    for (const x of [a, ...a.split(/\s+/)]) {
      const w = x.trim().toLowerCase();
      if (w.length >= 3 && lower.includes(w)) return 'Do not put the username or name inside the password.';
    }
  }
  return null;
}
