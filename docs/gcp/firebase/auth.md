# Firebase Auth

> Implementación de autenticación con Firebase Auth en backend y frontend.

## Backend Setup

### 1. Instalar firebase-admin

```bash
npm install firebase-admin
```

### 2. Crear adapter

**`src/infrastructure/firebase/firebase-auth.adapter.ts`:**

```typescript
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { IamPort } from '#domain/auth/iam.port';

export class FirebaseAuthAdapter implements IamPort {
  private auth: ReturnType<typeof getAuth>;

  constructor(serviceAccountKey: string) {
    const adminApp = initializeApp({
      credential: cert(JSON.parse(serviceAccountKey))
    });
    this.auth = getAuth(adminApp);
  }

  async validateToken(token: string) {
    try {
      const decodedToken = await this.auth.verifyIdToken(token);
      return {
        sub: decodedToken.uid,
        email: decodedToken.email,
        roles: decodedToken.roles || ['user']
      };
    } catch (error) {
      throw new Error(`Invalid Firebase token: ${error.message}`);
    }
  }

  async login(email: string, password: string) {
    // Firebase Auth no soporta login server-side con email/password
    // (client-side solo)
    throw new Error('Use client SDK for sign-in');
  }

  async register(email: string, password: string) {
    try {
      const user = await this.auth.createUser({
        email,
        password,
        displayName: email.split('@')[0]
      });
      return {
        keycloak_id: user.uid,
        email: user.email!,
        roles: ['user']
      };
    } catch (error) {
      throw new Error(`Firebase registration failed: ${error.message}`);
    }
  }
}
```

### 3. Middleware de validación

**`src/presentation/bootstrap/middlewares/firebase-jwt.middleware.ts`:**

```typescript
import { Request, Response, NextFunction } from 'express';
import type { IamPort } from '#domain/auth/iam.port';

export function createFirebaseJwtMiddleware(iamPort: IamPort) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing token' });
    }

    const token = authHeader.slice(7);
    try {
      const claims = await iamPort.validateToken(token);
      (req as any).user = claims;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}
```

## Frontend Setup (React/Next.js)

### 1. Instalar Firebase SDK

```bash
npm install firebase
```

### 2. Initialize Firebase

**`lib/firebase.ts`:**

```typescript
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
```

### 3. Sign-up Hook

**`hooks/useSignup.ts`:**

```typescript
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export async function useSignup(email: string, password: string) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const token = await userCredential.user.getIdToken();
    
    // Send token to backend
    const response = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email })
    });
    
    return response.json();
  } catch (error) {
    throw error;
  }
}
```

### 4. Sign-in Hook

**`hooks/useLogin.ts`:**

```typescript
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export async function useLogin(email: string, password: string) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const token = await userCredential.user.getIdToken();
    
    // Store token
    localStorage.setItem('firebaseToken', token);
    
    return { user: userCredential.user, token };
  } catch (error) {
    throw error;
  }
}
```

### 5. Protected Component

**`components/Protected.tsx`:**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export function Protected({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Please sign in</div>;

  return <>{children}</>;
}
```

## Social Login (Google)

### Backend: No cambios necesarios
Firebase maneja Google OAuth, token devuelto es válido para validar en backend.

### Frontend:

```typescript
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export async function googleSignIn() {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    const token = await result.user.getIdToken();
    // Send token to backend
  } catch (error) {
    console.error('Google sign-in failed:', error);
  }
}
```

## Environment Variables

### Backend (.env.production)

```bash
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
```

### Frontend (.env.local)

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=my-app.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=my-app
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=my-app.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abc123
```

## Migration Path: Keycloak → Firebase

### Phase 1: Coexist
- Ambos adapters en código
- Switch via env var `IAM_PROVIDER=keycloak|firebase`

### Phase 2: Gradual Migration
- 50% users → Firebase
- 50% users → Keycloak
- Monitor issues

### Phase 3: Retire Keycloak
- Todos → Firebase
- Remove Keycloak container

## Tests

```typescript
import { getAuth, connectAuthEmulator } from 'firebase/auth';

// In test setup
const auth = getAuth();
connectAuthEmulator(auth, 'http://localhost:9099');
```

## Troubleshooting

### "Firebase not initialized"
Asegurar que `initializeApp` se ejecuta antes de usar `getAuth`.

### "Token expired"
Frontend debe refrescar token automáticamente:

```typescript
const token = await user.getIdToken(true); // Force refresh
```

### "CORS error"
Backend CORS debe incluir Firebase domain.

## References

- Firebase Auth docs: https://firebase.google.com/docs/auth
- firebase-admin: https://firebase.google.com/docs/admin/setup
- Social sign-in: https://firebase.google.com/docs/auth/web/federated-auth
