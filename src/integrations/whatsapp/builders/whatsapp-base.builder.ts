import {
  WhatsAppMessageType,
  WhatsAppPayload,
  WhatsAppPayloadBase,
} from '../interfaces/whatsapp-message.interface';

/**
 * Builder base abstracto.
 * Todos los builders de mensajes extienden de aquí.
 * Para agregar un nuevo tipo de mensaje, crea una clase que extienda WhatsAppBaseBuilder.
 */
export abstract class WhatsAppBaseBuilder<TBuilder, TPayload extends WhatsAppPayloadBase> {
  protected payload: Partial<TPayload>;
  private readonly isPhoneNumberValid = /^\+[1-9]\d{7,14}$/;

  constructor() { this.payload = {} }

  protected readonly baseDefaults = {
    messaging_product: 'whatsapp' as const,
    recipient_type: 'individual' as const,
  };

  protected applyDefaults(): void {
    this.payload = {
      ...this.baseDefaults,
      ...this.payload,
    };
  }

  /**
   * Define el destinatario del mensaje
   */
  to(phoneNumber: string): TBuilder {
    // Normaliza el número: elimina espacios y guiones
    this.payload.to = phoneNumber.replace(/[\s\-()]/g, '');
    if (!this.isPhoneNumberValid.test(this.payload.to)) throw new Error('El número debe estar en formato internacional E.164 (ej: +51999999999)');
    return this as unknown as TBuilder;
  }

  /**
   * Establece el tipo de mensaje internamente
   */
  protected setType(type: WhatsAppMessageType): void {
    this.payload.type = type;
  }

  /**
   * Valida que el payload tenga los campos requeridos antes de construir
   */
  protected validate(): void {
    if (!this.payload.to) {
      throw new Error('El destinatario (to) es requerido');
    }
    if (!this.payload.type) {
      throw new Error('El tipo de mensaje es requerido');
    }
  }

  /**
   * Retorna el payload final listo para enviar a la API
   */
  build(): WhatsAppPayload {
    this.applyDefaults();
    this.validate();
    return this.payload as WhatsAppPayload;
  }
}