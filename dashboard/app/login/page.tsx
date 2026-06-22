'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      router.replace('/pipeline');
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 320,
          border: '0.5px solid var(--hairline)',
          background: '#fff',
          padding: 32,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 12, letterSpacing: '0.04em', marginBottom: 24 }}
        >
          <span className="bracket">[</span> PHILIP KWONG / AGENTS{' '}
          <span className="bracket">]</span>
        </div>

        <label className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          EMAIL
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ marginTop: 4, marginBottom: 16 }}
        />

        <label className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          PASSWORD
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ marginTop: 4, marginBottom: 24 }}
        />

        <button type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        {error && (
          <p
            className="mono"
            style={{ fontSize: 11, color: '#c0341d', marginTop: 16 }}
          >
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
