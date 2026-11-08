> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Generación de video Gemini Omni Flash

>  - Modelo oficial de generación de video multimodal todo en uno Gemini Omni Flash de Google
- Admite texto a video, imagen a video y video a video (edición), con entradas mixtas de texto + imagen + video
- Salida de 720p / 24fps, 3–10 segundos, con audio; admite edición conversacional en varios turnos
- API de tareas asíncronas. Tras el envío, consulte el resultado de la generación mediante el ID de la tarea 

```bash cURL theme={null}
curl --request POST \
  --url https://api.apimart.ai/v1/videos/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gemini-omni-flash-preview",
    "prompt": "a red apple on a wooden table, short cinematic clip",
    "aspect_ratio": "16:9"
  }'
```

```python Python theme={null}
import requests

url = "https://api.apimart.ai/v1/videos/generations"

payload = {
    "model": "gemini-omni-flash-preview",
    "prompt": "a red apple on a wooden table, short cinematic clip",
    "aspect_ratio": "16:9"
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
  model: "gemini-omni-flash-preview",
  prompt: "a red apple on a wooden table, short cinematic clip",
  aspect_ratio: "16:9"
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
  .catch(error => console.error("Error:", error));
```

```go Go theme={null}
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io/ioutil"
    "net/http"
)

func main() {
    url := "https://api.apimart.ai/v1/videos/generations"

    payload := map[string]interface{}{
        "model":        "gemini-omni-flash-preview",
        "prompt":       "a red apple on a wooden table, short cinematic clip",
        "aspect_ratio": "16:9",
    }

    jsonData, _ := json.Marshal(payload)

    req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
    req.Header.Set("Authorization", "Bearer <token>")
    req.Header.Set("Content-Type", "application/json")

    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        panic(err)
    }
    defer resp.Body.Close()

    body, _ := ioutil.ReadAll(resp.Body)
    fmt.Println(string(body))
}
```

```json 200 theme={null}
{
  "code": 200,
  "data": [
    {
      "status": "submitted",
      "task_id": "task_01KS1H7ZYSJWH1N779S2FSHTKA"
    }
  ]
}
```

```json 400 theme={null}
{
  "error": {
    "code": 400,
    "message": "Parámetros de solicitud no válidos",
    "type": "invalid_request_error"
  }
}
```

```json 401 theme={null}
{
  "error": {
    "code": 401,
    "message": "Error de autenticación, verifique su clave API",
    "type": "authentication_error"
  }
}
```

```json 402 theme={null}
{
  "error": {
    "code": 402,
    "message": "Saldo de cuenta insuficiente, recargue y vuelva a intentarlo",
    "type": "payment_required"
  }
}
```

```json 429 theme={null}
{
  "error": {
    "code": 429,
    "message": "Solicitudes demasiado frecuentes, vuelva a intentarlo más tarde",
    "type": "rate_limit_error"
  }
}
```

## Autenticación

**Authorization** `string` *required*

Todas las solicitudes requieren autenticación mediante Bearer Token.

Obtener una API Key:

Visite la [página de gestión de API Keys](https://apimart.ai/keys) para obtener su API Key.

Añada el siguiente encabezado al realizar solicitudes:

```
Authorization: Bearer YOUR_API_KEY
```

## Parámetros de la solicitud

**model** `string` *required*

Nombre del modelo de generación de video, fijado en `gemini-omni-flash-preview`.

**nsfw\_check** `boolean` (default: false)

Indica si se debe moderar el contenido antes de enviar la tarea de vídeo.

* `true`: revisar los prompts y las imágenes de entrada con `omni-moderation-latest`
* `false` u omitido: no enviar una solicitud de moderación, sin coste ni latencia de moderación adicionales (predeterminado)

**prompt** `string` *required*

Instrucción de texto. Para texto a video es la descripción de la escena; para imagen / video a video es la instrucción de acción / estilo / edición.

> [!NOTE]
>
> `prompt` y el material de referencia (`image_urls` / `video_urls`) deben proporcionarse **al menos uno de ellos**.

**image\_urls** `array\<string\>`

Imágenes de referencia, máximo **16**. Cada elemento es una URL `http(s)://`.

Admite JPEG / PNG. Para varios sujetos (por ejemplo, «gato + ovillo de lana») puede enviar varias imágenes y describir en el `prompt` cómo interactúan.

**video\_urls** `array\<string\>`

Video de referencia / a editar, **máximo 1** (no se admite la referencia a varios videos). Puede ser un enlace directo `http(s)://` o `data:video/...`.

> [!WARNING]
>
> * El video de referencia debe durar de 1 a 24 segundos; la recomendación oficial es **≤3 segundos**.
> * `video_urls` y `extend_from_task_id` son **mutuamente excluyentes**; proporcione solo uno de ellos, no ambos al mismo tiempo.

**aspect\_ratio** `string` (default: 16:9)

Relación de aspecto del video, que controla realmente la orientación de la imagen de salida.

> [!WARNING]
>
> Al proporcionar `video_urls`, el parámetro `aspect_ratio` no tendrá efecto.

Solo admite:

* `16:9` - horizontal (predeterminado)
* `9:16` - vertical

Otros valores se tratan como `16:9`.

**resolution** `string` (default: 720p)

Resolución del video. Actualmente solo admite `720p`.

**extend\_from\_task\_id** `string`

ID de la tarea anterior: introduzca el \*\* `task_id`\*\* de la tarea de generación anterior.

> [!WARNING]
>
> `extend_from_task_id` y `video_urls` son **mutuamente excluyentes**; proporcione solo uno de ellos, no ambos al mismo tiempo.

## Respuesta

**code** `integer`

Código de estado de la respuesta. En caso de éxito es `200`.

**data** `array`

Array de tareas devuelto.

**Elemento del array**

**status** `string`

Estado inicial de la tarea. En caso de envío exitoso es `submitted`.

**task\_id** `string`

Identificador único de la tarea, usado para consultar su estado y resultado.

## Consultar el resultado de la tarea

La generación de video es una tarea asíncrona. Tras el envío se devuelve un `task_id`. Use el endpoint [Obtener estado de la tarea](https://docs.apimart.ai/es/api-reference/tasks/status.md) para consultar el progreso y el resultado de la generación.

### Ejemplo de resultado exitoso

```json theme={null}
{
  "code": 200,
  "data": {
    "id": "task_01KS1H7ZYSJWH1N779S2FSHTKA",
    "status": "completed",
    "progress": 100,
    "created": 1779246294,
    "completed": 1779246334,
    "actual_time": 40,
    "estimated_time": 60,
    "cost": 1.0,
    "credits_cost": 10,
    "result": {
      "videos": [
        {
          "url": ["https://cdn.example.com/gemini_omni_xxx.mp4"],
          "expires_at": 1779332760
        }
      ]
    }
  }
}
```

## Casos de uso

### Escenario 1: Texto a video

```json theme={null}
{
  "model": "gemini-omni-flash-preview",
  "prompt": "a blue butterfly landing on a flower, macro, soft light",
  "aspect_ratio": "9:16"
}
```

### Escenario 2: Imagen a video

```json theme={null}
{
  "model": "gemini-omni-flash-preview",
  "prompt": "turn this drawing into realistic footage, use it only as a motion guide",
  "image_urls": ["https://example.com/sketch.jpg"]
}
```

### Escenario 3: Video a video

```json theme={null}
{
  "model": "gemini-omni-flash-preview",
  "prompt": "when the person touches the mirror, make it ripple like liquid",
  "video_urls": ["https://example.com/clip.mp4"]
}
```


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.