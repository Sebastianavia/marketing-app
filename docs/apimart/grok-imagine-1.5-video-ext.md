> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Generación de video Grok Imagine 1.5

>  - Modo de procesamiento asíncrono, devuelve un ID de tarea para consultas posteriores
- Generación de video con IA de alta calidad, admite text-to-video e image-to-video
- Opciones flexibles de relación de aspecto y calidad para distintas necesidades creativas 

> [!NOTE]
>
> **Nombre del modelo**: usa `grok-imagine-1.5-video-ext` en este endpoint.

```bash cURL theme={null}
# Define model como "grok-imagine-1.5-video-ext"
curl --request POST \
  --url https://api.apimart.ai/v1/videos/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "grok-imagine-1.5-video-ext",
    "prompt": "A dog running on the beach, sunny weather, slow motion",
    "size": "16:9",
    "duration": 6,
    "resolution": "720p"
  }'
```

```python Python theme={null}
import requests

url = "https://api.apimart.ai/v1/videos/generations"

payload = {
    "model": "grok-imagine-1.5-video-ext",
    "prompt": "A dog running on the beach, sunny weather, slow motion",
    "size": "16:9",
    "duration": 6,
    "resolution": "720p"
}

headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)

print(response.json())
```

```javascript JavaScript theme={null}
const url = "https://api.apimart.ai/v1/videos/generations";

const payload = {
  model: "grok-imagine-1.5-video-ext",
  prompt: "A dog running on the beach, sunny weather, slow motion",
  size: "16:9",
  duration: 6,
  resolution: "720p"
};

const headers = {
  "Authorization": "Bearer <token>",
  "Content-Type": "application/json"
};

fetch(url, {
  method: "POST",
  headers: headers,
  body: JSON.stringify(payload)
})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error));
```

```json 200 theme={null}
{
  "code": 200,
  "data": [
    {
      "task_id": "task_01JNXXXXXXXXXXXXXXXXXX",
      "status": "submitted"
    }
  ]
}
```

```json 400 theme={null}
{
  "error": {
    "code": 400,
    "message": "Invalid request parameters",
    "type": "invalid_request_error"
  }
}
```

```json 401 theme={null}
{
  "error": {
    "code": 401,
    "message": "Authentication failed, please check your API key",
    "type": "authentication_error"
  }
}
```

```json 402 theme={null}
{
  "error": {
    "code": 402,
    "message": "Insufficient balance, please top up and try again",
    "type": "payment_required"
  }
}
```

```json 403 theme={null}
{
  "error": {
    "code": 403,
    "message": "Access forbidden, you do not have permission to access this resource",
    "type": "permission_error"
  }
}
```

```json 429 theme={null}
{
  "error": {
    "code": 429,
    "message": "Too many requests, please try again later",
    "type": "rate_limit_error"
  }
}
```

```json 500 theme={null}
{
  "error": {
    "code": 500,
    "message": "Internal server error, please try again later",
    "type": "server_error"
  }
}
```

```json 502 theme={null}
{
  "error": {
    "code": 502,
    "message": "Bad gateway, server temporarily unavailable",
    "type": "bad_gateway"
  }
}
```

## Autorizaciones

**Authorization** `string` *required*

Todas las APIs requieren autenticación mediante Bearer Token

Obtener API Key:

Visite la [página de gestión de API Keys](https://apimart.ai/keys) para obtener su API Key

Añádala al encabezado de la solicitud:

```
Authorization: Bearer YOUR_API_KEY
```

## Parámetros de la solicitud

**model** `string` *required* (default: grok-imagine-1.5-video-ext)

Nombre del modelo de generación de video

Modelos compatibles:

* `grok-imagine-1.5-video-ext` - Generación de vídeo Grok

Ejemplo: `"grok-imagine-1.5-video-ext"`

> [!NOTE]
>
> Usa siempre `grok-imagine-1.5-video-ext` en las solicitudes nuevas.

**nsfw\_check** `boolean` (default: false)

Indica si se debe moderar el contenido antes de enviar la tarea de vídeo.

* `true`: revisar los prompts y las imágenes de entrada con `omni-moderation-latest`
* `false` u omitido: no enviar una solicitud de moderación, sin coste ni latencia de moderación adicionales (predeterminado)

**prompt** `string` *required*

Descripción del contenido del video, admite múltiples idiomas

**size** `string` (default: 16:9)

Tamaño del video

Opciones:

* `16:9` - Horizontal (predeterminado)
* `9:16` - Vertical
* `1:1` - Cuadrado
* `3:2` - Horizontal
* `2:3` - Vertical

**duration** `integer` (default: 6)

Duración del video (segundos)

Rango: 6-15 (mínimo 6 segundos, máximo 15 segundos)

**⚠️ Nota:** Debe ser un número simple (por ejemplo, `6`), sin comillas, de lo contrario se producirá un error

**resolution** `string` (default: 480p)

Calidad del video

Opciones:

* `480p` - Definición estándar (predeterminado)
* `720p` - Alta definición

**image\_urls** `string[]`

Lista de URLs de imágenes de referencia

**Límites:**

* Máximo 7 imágenes
* Deben ser URLs de acceso público
* No se admite el formato Base64

> [!TIP]
>
> Tras subir una imagen de referencia, la relación de aspecto coincidirá automáticamente con la de la imagen de referencia.

## Respuesta

**code** `integer`

Código de estado de la respuesta

**data** `object[]`

Array de datos de la respuesta

**Propiedades**

**task\_id** `string`

Identificador único de la tarea

**status** `string`

Estado de la tarea

* `submitted` - Enviada

> [!NOTE]
>
> **Consultar el resultado de la tarea**
>
> La generación de video es una tarea asíncrona. Tras la solicitud, se devolverá un `task_id`. Use el endpoint [Obtener estado de la tarea](https://docs.apimart.ai/es/api-reference/tasks/status.md) para consultar el progreso y los resultados de la generación.

## Casos de uso

### Caso 1: Texto a video

```json theme={null}
{
  "model": "grok-imagine-1.5-video-ext",
  "prompt": "A dog running on the beach, sunny weather, slow motion",
  "size": "16:9",
  "duration": 6
}
```

### Caso 2: Imagen a video

```json theme={null}
{
  "model": "grok-imagine-1.5-video-ext",
  "prompt": "Bring the scene to life with natural dynamic effects",
  "image_urls": ["https://example.com/start.png"],
  "size": "16:9",
  "duration": 10,
  "resolution": "720p"
}
```


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.