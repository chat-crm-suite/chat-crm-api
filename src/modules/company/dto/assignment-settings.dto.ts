import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

/**
 * Configuración de asignación automática por empresa (Q18).
 * Solo admin/manager de la empresa pueden modificarla.
 */
export class UpdateAssignmentSettingsDto {
  @IsOptional()
  @IsBoolean()
  autoAssignEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  autoAssignMaxChats?: number;

  @IsOptional()
  @IsBoolean()
  autoAssignSticky?: boolean;

  @IsOptional()
  @IsBoolean()
  autoAssignNotifySupervisors?: boolean;
}
