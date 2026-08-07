import type { FastifyInstance } from 'fastify';
import { NotFound } from '@crms/kernel';
import { aiPlanService } from '@crms/ai-engine';
import { assert } from '@crms/permissions';
import { authed } from '../lib/context.js';

/**
 * Official application templates (PRD §45). Each blueprint is a list of the same
 * operations the AI generator emits, so instantiating one reuses the AIPlan
 * executor (modules → fields → relations → views/pipelines/dashboards).
 */
interface Blueprint {
  key: string;
  name: string;
  description: string;
  operations: Array<{ op: string; args: Record<string, unknown> }>;
}

const M = (key: string, name: string, namePlural: string, icon: string) => ({ op: 'create_module', args: { key, name, namePlural, icon } });
const F = (moduleKey: string, key: string, name: string, type: string, extra: Record<string, unknown> = {}) => ({ op: 'create_field', args: { moduleKey, key, name, type, ...extra } });
const STATUS = (moduleKey: string, options: Array<[string, string]>) =>
  F(moduleKey, 'estado', 'Estado', 'status', { config: { options: options.map(([value, label]) => ({ value, label })) } });
const REL = (key: string, name: string, source: string, target: string) => ({ op: 'create_relation', args: { key, name, type: 'one_to_many', sourceModuleKey: source, targetModuleKey: target } });
const KANBAN = (moduleKey: string) => ({ op: 'create_view', args: { moduleKey, key: 'tablero', name: 'Tablero', type: 'kanban' } });
const PIPE = (moduleKey: string, stages: Array<[string, string]>) => ({
  op: 'create_pipeline',
  args: {
    moduleKey,
    key: 'proceso',
    name: 'Proceso',
    stages: stages.map(([key, name]) => ({ key, name })),
    transitions: stages.slice(1).map(([to], i) => ({ from: stages[i]![0], to })),
  },
});
const DASH = (name: string, widgets: Array<Record<string, unknown>>) => ({ op: 'create_dashboard', args: { key: 'principal', name, widgets } });

const BLUEPRINTS: Blueprint[] = [
  {
    key: 'crm_ventas',
    name: 'CRM de Ventas',
    description: 'Leads, contactos, oportunidades y actividades con pipeline de ventas.',
    operations: [
      M('leads', 'Lead', 'Leads', '🎯'), F('leads', 'nombre', 'Nombre', 'text_short', { required: true }), F('leads', 'email', 'Email', 'email'), F('leads', 'telefono', 'Teléfono', 'phone'), F('leads', 'valor', 'Valor estimado', 'currency'),
      STATUS('leads', [['nuevo', 'Nuevo'], ['contactado', 'Contactado'], ['calificado', 'Calificado'], ['ganado', 'Ganado'], ['perdido', 'Perdido']]),
      M('contactos', 'Contacto', 'Contactos', '👤'), F('contactos', 'nombre', 'Nombre', 'text_short', { required: true }), F('contactos', 'email', 'Email', 'email'), F('contactos', 'empresa', 'Empresa', 'text_short'),
      M('actividades', 'Actividad', 'Actividades', '📞'), F('actividades', 'asunto', 'Asunto', 'text_short', { required: true }), F('actividades', 'fecha', 'Fecha', 'datetime'),
      REL('contacto_lead', 'Contacto', 'leads', 'contactos'), REL('actividad_lead', 'Lead', 'actividades', 'leads'),
      KANBAN('leads'), PIPE('leads', [['nuevo', 'Nuevo'], ['contactado', 'Contactado'], ['calificado', 'Calificado'], ['ganado', 'Ganado'], ['perdido', 'Perdido']]),
      DASH('Ventas', [{ key: 'total', title: 'Leads', type: 'metric', moduleKey: 'leads', aggregate: 'count' }, { key: 'por_estado', title: 'Por estado', type: 'bar', moduleKey: 'leads', aggregate: 'count', groupBy: 'estado' }]),
    ],
  },
  {
    key: 'inmobiliaria',
    name: 'Inmobiliaria',
    description: 'Propiedades, clientes, visitas y oportunidades para bienes raíces.',
    operations: [
      M('propiedades', 'Propiedad', 'Propiedades', '🏠'), F('propiedades', 'titulo', 'Título', 'text_short', { required: true }), F('propiedades', 'precio', 'Precio', 'currency'), F('propiedades', 'direccion', 'Dirección', 'text_long'),
      STATUS('propiedades', [['disponible', 'Disponible'], ['reservada', 'Reservada'], ['vendida', 'Vendida']]),
      M('clientes', 'Cliente', 'Clientes', '🧑'), F('clientes', 'nombre', 'Nombre', 'text_short', { required: true }), F('clientes', 'email', 'Email', 'email'), F('clientes', 'telefono', 'Teléfono', 'phone'),
      M('visitas', 'Visita', 'Visitas', '📅'), F('visitas', 'fecha', 'Fecha', 'datetime', { required: true }),
      REL('visita_prop', 'Propiedad', 'visitas', 'propiedades'), REL('visita_cliente', 'Cliente', 'visitas', 'clientes'),
      KANBAN('propiedades'),
      DASH('Inmobiliaria', [{ key: 'props', title: 'Propiedades', type: 'metric', moduleKey: 'propiedades', aggregate: 'count' }, { key: 'por_estado', title: 'Por estado', type: 'bar', moduleKey: 'propiedades', aggregate: 'count', groupBy: 'estado' }]),
    ],
  },
  {
    key: 'clinica',
    name: 'Clínica / Consultorio',
    description: 'Pacientes, médicos, citas y expedientes.',
    operations: [
      M('pacientes', 'Paciente', 'Pacientes', '🧑‍⚕️'), F('pacientes', 'nombre', 'Nombre', 'text_short', { required: true }), F('pacientes', 'fecha_nac', 'Fecha de nacimiento', 'date'), F('pacientes', 'telefono', 'Teléfono', 'phone'),
      M('medicos', 'Médico', 'Médicos', '👨‍⚕️'), F('medicos', 'nombre', 'Nombre', 'text_short', { required: true }), F('medicos', 'especialidad', 'Especialidad', 'text_short'),
      M('citas', 'Cita', 'Citas', '📆'), F('citas', 'fecha', 'Fecha', 'datetime', { required: true }), STATUS('citas', [['agendada', 'Agendada'], ['atendida', 'Atendida'], ['cancelada', 'Cancelada']]),
      REL('cita_paciente', 'Paciente', 'citas', 'pacientes'), REL('cita_medico', 'Médico', 'citas', 'medicos'),
      KANBAN('citas'),
      DASH('Clínica', [{ key: 'citas', title: 'Citas', type: 'metric', moduleKey: 'citas', aggregate: 'count' }, { key: 'por_estado', title: 'Por estado', type: 'bar', moduleKey: 'citas', aggregate: 'count', groupBy: 'estado' }]),
    ],
  },
  {
    key: 'soporte',
    name: 'Soporte / Tickets',
    description: 'Tickets de soporte con prioridades, agentes y SLA.',
    operations: [
      M('tickets', 'Ticket', 'Tickets', '🎫'), F('tickets', 'asunto', 'Asunto', 'text_short', { required: true }), F('tickets', 'descripcion', 'Descripción', 'text_long'),
      F('tickets', 'prioridad', 'Prioridad', 'select', { config: { options: [{ value: 'baja', label: 'Baja' }, { value: 'media', label: 'Media' }, { value: 'alta', label: 'Alta' }] } }),
      STATUS('tickets', [['abierto', 'Abierto'], ['en_proceso', 'En proceso'], ['resuelto', 'Resuelto'], ['cerrado', 'Cerrado']]),
      M('clientes', 'Cliente', 'Clientes', '🧑'), F('clientes', 'nombre', 'Nombre', 'text_short', { required: true }), F('clientes', 'email', 'Email', 'email'),
      REL('ticket_cliente', 'Cliente', 'tickets', 'clientes'),
      KANBAN('tickets'), PIPE('tickets', [['abierto', 'Abierto'], ['en_proceso', 'En proceso'], ['resuelto', 'Resuelto'], ['cerrado', 'Cerrado']]),
      DASH('Soporte', [{ key: 'abiertos', title: 'Tickets', type: 'metric', moduleKey: 'tickets', aggregate: 'count' }, { key: 'por_estado', title: 'Por estado', type: 'bar', moduleKey: 'tickets', aggregate: 'count', groupBy: 'estado' }]),
    ],
  },
  {
    key: 'inventario',
    name: 'Inventario',
    description: 'Productos, categorías, proveedores y movimientos de stock.',
    operations: [
      M('productos', 'Producto', 'Productos', '📦'), F('productos', 'nombre', 'Nombre', 'text_short', { required: true }), F('productos', 'sku', 'SKU', 'text_short', { unique: true }), F('productos', 'precio', 'Precio', 'currency'), F('productos', 'stock', 'Stock', 'integer'),
      M('proveedores', 'Proveedor', 'Proveedores', '🏭'), F('proveedores', 'nombre', 'Nombre', 'text_short', { required: true }), F('proveedores', 'email', 'Email', 'email'),
      M('movimientos', 'Movimiento', 'Movimientos', '🔁'), F('movimientos', 'cantidad', 'Cantidad', 'integer', { required: true }), F('movimientos', 'fecha', 'Fecha', 'datetime'),
      REL('producto_prov', 'Proveedor', 'productos', 'proveedores'), REL('mov_producto', 'Producto', 'movimientos', 'productos'),
      DASH('Inventario', [{ key: 'productos', title: 'Productos', type: 'metric', moduleKey: 'productos', aggregate: 'count' }, { key: 'stock', title: 'Stock total', type: 'metric', moduleKey: 'productos', aggregate: 'sum', field: 'stock' }]),
    ],
  },
  {
    key: 'proyectos',
    name: 'Gestión de Proyectos',
    description: 'Proyectos, tareas y miembros con tablero kanban.',
    operations: [
      M('proyectos', 'Proyecto', 'Proyectos', '📁'), F('proyectos', 'nombre', 'Nombre', 'text_short', { required: true }), F('proyectos', 'fecha_fin', 'Fecha límite', 'date'),
      M('tareas', 'Tarea', 'Tareas', '✅'), F('tareas', 'titulo', 'Título', 'text_short', { required: true }), STATUS('tareas', [['pendiente', 'Pendiente'], ['en_progreso', 'En progreso'], ['hecho', 'Hecho']]),
      REL('tarea_proyecto', 'Proyecto', 'tareas', 'proyectos'),
      KANBAN('tareas'), PIPE('tareas', [['pendiente', 'Pendiente'], ['en_progreso', 'En progreso'], ['hecho', 'Hecho']]),
      DASH('Proyectos', [{ key: 'tareas', title: 'Tareas', type: 'metric', moduleKey: 'tareas', aggregate: 'count' }, { key: 'por_estado', title: 'Por estado', type: 'bar', moduleKey: 'tareas', aggregate: 'count', groupBy: 'estado' }]),
    ],
  },
];

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/templates', authed(async () =>
    BLUEPRINTS.map((b) => ({ key: b.key, name: b.name, description: b.description, modules: b.operations.filter((o) => o.op === 'create_module').length })),
  ));

  app.post('/templates/:key/apply', authed(async (req) => {
    await assert('manage_config', { type: 'application' });
    const { key } = req.params as { key: string };
    const bp = BLUEPRINTS.find((b) => b.key === key);
    if (!bp) throw NotFound('Template', key);
    const planId = await aiPlanService.create({ summary: `Plantilla: ${bp.name}`, operations: bp.operations } as never);
    const result = await aiPlanService.execute(planId);
    return { planId, applied: result.results.length };
  }));
}
