export interface SetupStatus {
  /**
   * Hay empresa + member admin activo. Un usuario suelto (sin empresa) no
   * cuenta: mientras no exista una membresía admin, el wizard sigue visible.
   */
  initialized: boolean;
  hasAdmin: boolean;
  hasCompany: boolean;
  hasWhatsapp: boolean;
}

export interface SetupResult {
  user: { id: string; username: string };
  company: { id: string; name: string };
  whatsapp: { id: string; webhookVerifyToken: string } | null;
}
