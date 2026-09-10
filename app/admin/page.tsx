import { redirect } from "next/navigation"
import { ADMIN_ROUTES } from "@/constants/admin"
export default function AdminPage() { redirect(ADMIN_ROUTES.models) }
