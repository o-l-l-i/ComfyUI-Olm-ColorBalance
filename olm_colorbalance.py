import torch
from aiohttp import web
from server import PromptServer
import base64
from io import BytesIO
from PIL import Image


DEBUG_MODE = False
PREVIEW_RESOLUTION = 512


def debug_print(*args, **kwargs):
    if DEBUG_MODE:
        print(*args, **kwargs)


thumbnail_cache = {}


class OlmColorBalance:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "version": ("STRING", {"default": "init"}),
                "image": ("IMAGE",),
                "shadows_r": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "shadows_g": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "shadows_b": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "midtones_r": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "midtones_g": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "midtones_b": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "highlights_r": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "highlights_g": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "highlights_b": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "preserve_luminosity": ("BOOLEAN", {"default": True}),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01}),
            }
        }


    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "color_balance"
    CATEGORY = "image/color"


    def color_balance(
        self,
        version,
        image: torch.Tensor,
        shadows_r, shadows_g, shadows_b,
        midtones_r, midtones_g, midtones_b,
        highlights_r, highlights_g, highlights_b,
        preserve_luminosity,
        strength
    ):
        debug_print("=" * 60)
        debug_print("[OlmColorBalance] Applying color balance with values:")
        debug_print("[OlmColorBalance] Shadows:", shadows_r, shadows_g, shadows_b)
        debug_print("[OlmColorBalance] Midtones:", midtones_r, midtones_g, midtones_b)
        debug_print("[OlmColorBalance] Highlights:", highlights_r, highlights_g, highlights_b)
        debug_print("[OlmColorBalance] Preserve luminosity:", preserve_luminosity)
        debug_print("[OlmColorBalance] Strength (multiplier:)", strength)
        try:
            if not isinstance(image, torch.Tensor):
                raise TypeError("Input image must be a torch.Tensor")
            thumbnail_cache["colorbalance_image"] = image.clone().detach()
            tone_adjustments = {
                "shadows": (float(shadows_r), float(shadows_g), float(shadows_b)),
                "midtones": (float(midtones_r), float(midtones_g), float(midtones_b)),
                "highlights": (float(highlights_r), float(highlights_g), float(highlights_b)),
            }
            adjusted = apply_color_balance(
                image,
                tone_adjustments,
                preserve_luminosity,
                strength
            )
            debug_print("=" * 60)
            return {
                "ui": {
                    "message": "Color balance applied!",
                },
                "result": (adjusted,),
            }
        except Exception as e:
            print(f"[OlmColorBalance Error] {e}")
            return {
                "ui": {
                    "message": f"Failed to apply color balance: {e}",
                },
                "result": (image,),
            }


@PromptServer.instance.routes.post("/olm/api/colorbalance/update")
async def handle_colorbalance_preview(request):
    debug_print("[OlmColorBalance] /olm/api/colorbalance/update")
    try:
        data = await request.json()
        debug_print("[OlmColorBalance] data:", data)
        tones_raw = data.get("tones", {})
        tones = {}
        for key in ["shadows", "midtones", "highlights"]:
            tone = tones_raw[key]
            tones[key] = (
                tone.get("r", 0.0),
                tone.get("g", 0.0),
                tone.get("b", 0.0),
            )
        debug_print("")
        debug_print("[OlmColorBalance] tones:", tones)
        debug_print("=" * 60)
        preserve_luminosity = data.get("preserve_luminosity", True)
        strength = data.get("strength", 1.0)
        image = load_thumbnail_image("colorbalance_image")
        adjusted = apply_color_balance(
            image,
            tones,
            preserve_luminosity,
            strength
        )
        img = tensor_to_pil(adjusted)
        img_str = encode_to_base64(img)
        return web.json_response({
            "status": "success",
            "updatedimage": f"data:image/png;base64,{img_str}"
        })
    except Exception as e:
        debug_print("[OlmColorBalance] Error during color balance preview:", str(e))
        return web.json_response({"status": "error", "message": str(e)}, status=400)


def apply_color_balance(image, tone_adjustments, preserve_luminosity=True, strength=1.0):
    expected_keys = {"shadows", "midtones", "highlights"}
    if not isinstance(tone_adjustments, dict):
        raise ValueError("[Color Balance] tone_adjustments must be a dictionary.")
    for key in expected_keys:
        if key not in tone_adjustments:
            raise ValueError(f"[Color Balance] Missing tone adjustment for '{key}'")
        vals = tone_adjustments[key]
        if not (isinstance(vals, (list, tuple)) and len(vals) == 3):
            raise ValueError(f"[Color Balance] Tone adjustment '{key}' must be a list of 3 values.")
    if image.dim() == 3:
        image = image.unsqueeze(0)
    img = image.clone()
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    lum = 0.3 * r + 0.59 * g + 0.11 * b

    def bell_curve(x, center, width):
        return torch.exp(-((x - center) ** 2) / (2 * width ** 2))

    shadows = bell_curve(lum, 0.0, 0.25)
    midtones = bell_curve(lum, 0.5, 0.25)
    highlights = bell_curve(lum, 1.0, 0.25)

    def adjust(channel, mask, amount):
        return channel + (amount * 0.25 * mask * strength)

    r = adjust(r, shadows, tone_adjustments["shadows"][0])
    g = adjust(g, shadows, tone_adjustments["shadows"][1])
    b = adjust(b, shadows, tone_adjustments["shadows"][2])
    r = adjust(r, midtones, tone_adjustments["midtones"][0])
    g = adjust(g, midtones, tone_adjustments["midtones"][1])
    b = adjust(b, midtones, tone_adjustments["midtones"][2])
    r = adjust(r, highlights, tone_adjustments["highlights"][0])
    g = adjust(g, highlights, tone_adjustments["highlights"][1])
    b = adjust(b, highlights, tone_adjustments["highlights"][2])

    if preserve_luminosity:
        new_lum = 0.3 * r + 0.59 * g + 0.11 * b
        lum_diff = (lum - new_lum).unsqueeze(-1)
        out = torch.stack([r, g, b], dim=-1)
        out += lum_diff
    else:
        out = torch.stack([r, g, b], dim=-1)
    return torch.clamp(out, 0.0, 1.0)


def load_thumbnail_image(cache_key):
    if cache_key not in thumbnail_cache:
        raise ValueError("[OlmColorBalance] No cached image available. Please run the node first.")
    image = thumbnail_cache[cache_key]
    return downscale_image(image, size=(PREVIEW_RESOLUTION, PREVIEW_RESOLUTION))


def downscale_image(tensor, size=(PREVIEW_RESOLUTION, PREVIEW_RESOLUTION)):
    if tensor.dim() == 3:
        tensor = tensor.unsqueeze(0)
    B, H, W, C = tensor.shape
    max_w, max_h = size
    aspect = W / H
    if W / max_w > H / max_h:
        target_w = max_w
        target_h = round(max_w / aspect)
    else:
        target_h = max_h
        target_w = round(max_h * aspect)
    resized = torch.nn.functional.interpolate(
        tensor.permute(0, 3, 1, 2),
        size=(target_h, target_w),
        mode='bilinear',
        align_corners=False
    ).permute(0, 2, 3, 1)
    return resized.squeeze(0)


def tensor_to_pil(tensor):
    tensor = tensor.squeeze(0).cpu().numpy()
    return Image.fromarray((tensor * 255).astype("uint8"))


def encode_to_base64(img: Image.Image) -> str:
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


NODE_CLASS_MAPPINGS = {
    "OlmColorBalance": OlmColorBalance
}


NODE_DISPLAY_NAME_MAPPINGS = {
    "OlmColorBalance": "Olm Color Balance"
}


WEB_DIRECTORY = "./web"
