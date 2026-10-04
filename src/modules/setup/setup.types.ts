export interface SetupStatus {
  /**
   * Hay empresa + member admin activo. Un usuario suelto (sin empresa) no
   * cuenta: mientras no exista una membresía admin, el wizard sigue visible.
   */
  initialized: boolean;
  hasAdmin: boolean;
  hasCompany: boolean;
  hasWhatsapp: boolean;
  /** Existe al menos un usuario (aunque todavía no tenga empresa). */
  hasUsers: boolean;
  /** La API exige token para completar el primer arranque. */
  requiresSetupToken: boolean;
}

export interface SetupResult {
  user: { id: string; username: string };
  company: { id: string; name: string };
  whatsapp: { id: string; webhookVerifyToken: string } | null;
}
