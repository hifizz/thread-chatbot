import { Suspense } from "react"
import { connection } from "next/server"
import { AuthForm } from "@/components/auth/auth-form"
import { isGoogleAuthEnabled } from "@/lib/auth/social"

export default async function SignInPage() {
  await connection()
  return (
    <Suspense>
      <AuthForm mode="sign-in" googleEnabled={isGoogleAuthEnabled()} />
    </Suspense>
  )
}
