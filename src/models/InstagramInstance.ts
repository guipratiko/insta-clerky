import mongoose, { Document, Schema } from 'mongoose';
import { generateInstanceToken } from '../utils/tokenGenerator';
import { generateInstanceName } from '../utils/tokenGenerator';

export interface IInstagramInstance extends Document {
  instanceName: string; // Nome interno gerado automaticamente
  name: string; // Nome escolhido pelo usuário (apenas para exibição)
  userId: mongoose.Types.ObjectId;
  token?: string; // Token para autenticação de webhooks externos
  instagramAccountId: string; // ID da conta no Instagram
  username: string; // Username do Instagram
  accessToken: string; // Token de acesso long-lived
  pageId: string; // ID da página associada
  pageName: string; // Nome da página
  tokenExpiresAt: Date; // Data de expiração do token
  status: 'created' | 'connecting' | 'connected' | 'disconnected' | 'error';
  webhookIds: string[]; // IDs alternativos para webhooks
  createdAt: Date;
  updatedAt: Date;
}

const InstagramInstanceSchema: Schema = new Schema(
  {
    instanceName: {
      type: String,
      required: [true, 'Nome da instância é obrigatório'],
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Nome da instância é obrigatório'],
      trim: true,
      minlength: [3, 'Nome deve ter no mínimo 3 caracteres'],
      maxlength: [50, 'Nome deve ter no máximo 50 caracteres'],
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Usuário é obrigatório'],
    },
    token: {
      type: String,
      required: true,
      unique: true,
      default: () => generateInstanceToken(),
    },
    instagramAccountId: {
      type: String,
      required: [true, 'ID da conta Instagram é obrigatório'],
      trim: true,
    },
    username: {
      type: String,
      required: [true, 'Username do Instagram é obrigatório'],
      trim: true,
    },
    accessToken: {
      type: String,
      required: [true, 'Token de acesso é obrigatório'],
      select: false, // Não retornar token por padrão
    },
    pageId: {
      type: String,
      required: [true, 'ID da página é obrigatório'],
      trim: true,
    },
    pageName: {
      type: String,
      required: [true, 'Nome da página é obrigatório'],
      trim: true,
    },
    tokenExpiresAt: {
      type: Date,
      required: [true, 'Data de expiração do token é obrigatória'],
    },
    status: {
      type: String,
      enum: ['created', 'connecting', 'connected', 'disconnected', 'error'],
      default: 'created',
    },
    webhookIds: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Hook pre-save para garantir que o token seja sempre gerado
InstagramInstanceSchema.pre('save', async function (next) {
  // Se não tiver token, gerar um novo
  if (!this.token || this.token === '') {
    let newToken = generateInstanceToken();
    // Garantir que o token seja único
    const InstagramInstanceModel = this.constructor as typeof InstagramInstance;
    let existingInstance = await InstagramInstanceModel.findOne({ token: newToken });
    while (existingInstance) {
      newToken = generateInstanceToken();
      existingInstance = await InstagramInstanceModel.findOne({ token: newToken });
    }
    this.token = newToken;
  }

  // Se não tiver instanceName, gerar um novo
  if (!this.instanceName || this.instanceName === '') {
    let newInstanceName = generateInstanceName();
    // Garantir que o instanceName seja único
    const InstagramInstanceModel = this.constructor as typeof InstagramInstance;
    let existingInstance = await InstagramInstanceModel.findOne({ instanceName: newInstanceName });
    while (existingInstance) {
      newInstanceName = generateInstanceName();
      existingInstance = await InstagramInstanceModel.findOne({ instanceName: newInstanceName });
    }
    this.instanceName = newInstanceName;
  }

  next();
});

// Índices para melhor performance
InstagramInstanceSchema.index({ userId: 1 });
InstagramInstanceSchema.index({ instagramAccountId: 1 });
InstagramInstanceSchema.index({ status: 1 });
// token e instanceName já têm índices únicos criados automaticamente pelo unique: true

const InstagramInstance = mongoose.model<IInstagramInstance>('InstagramInstance', InstagramInstanceSchema);

export default InstagramInstance;
