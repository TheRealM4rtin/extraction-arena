import json
import os
import sys
from typing import Any

try:
    from docling.datamodel import vlm_model_specs
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import VlmPipelineOptions
    from docling.document_converter import DocumentConverter, ImageFormatOption
except ImportError as exc:
    raise SystemExit(
        'Docling imports failed. Install Docling with MLX support in the Python environment '
        'pointed to by DOCLING_PYTHON_PATH. '
        f'Original import error: {exc}'
    )


# Each preset maps to an ordered list of candidate constant names on
# `vlm_model_specs`. Docling renamed the bare constants (e.g. SMOLDOCLING) to a
# backend-suffixed form (e.g. SMOLDOCLING_TRANSFORMERS) across versions, so we
# try the newest name first and fall back to the legacy one. The non-MLX
# presets use the Transformers backend, which is the only one that runs inside
# the Linux/x86 Docker container (MLX is Apple-Silicon-only).
MODEL_PRESETS: dict[str, tuple[str, list[str]]] = {
    'smoldocling_mlx': ('SmolDocling-256M (MLX)', ['SMOLDOCLING_MLX']),
    'granitedocling_mlx': ('GraniteDocling-258M (MLX)', ['GRANITEDOCLING_MLX']),
    'smoldocling': (
        'SmolDocling-256M',
        ['SMOLDOCLING_TRANSFORMERS', 'SMOLDOCLING'],
    ),
    'granitedocling': (
        'GraniteDocling-258M',
        ['GRANITEDOCLING_TRANSFORMERS', 'GRANITEDOCLING'],
    ),
}


def read_model_preset() -> tuple[str, Any]:
    key = os.environ.get('DOCLING_MODEL', 'smoldocling_mlx').strip().lower()
    if key not in MODEL_PRESETS:
        supported = ', '.join(sorted(MODEL_PRESETS))
        raise ValueError(f'Unsupported DOCLING_MODEL "{key}". Supported values: {supported}.')
    model_label, candidates = MODEL_PRESETS[key]
    vlm_options = next(
        (getattr(vlm_model_specs, name, None) for name in candidates),
        None,
    )
    if vlm_options is None:
        mlx_only = key.endswith('_mlx')
        hint = ' (MLX is only available on bare-metal Apple Silicon, not in Docker)' if mlx_only else ''
        raise ValueError(f'Model preset "{key}" is not available in this Docling installation.{hint}')
    return model_label, vlm_options


def build_converter() -> tuple[str, DocumentConverter]:
    model_label, vlm_options = read_model_preset()
    pipeline_options = VlmPipelineOptions(vlm_options=vlm_options)
    converter = DocumentConverter(
        allowed_formats=[InputFormat.IMAGE],
        format_options={
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=pipeline_options),
        }
    )
    return model_label, converter


def export_page_markdown(doc: Any, doc_dict: dict[str, Any]) -> str:
    if hasattr(doc, 'export_to_markdown'):
        markdown = doc.export_to_markdown()
        if isinstance(markdown, str) and markdown.strip():
            return markdown

    if hasattr(doc, 'export_to_text'):
        text = doc.export_to_text()
        if isinstance(text, str) and text.strip():
            return text

    fallback_lines = flatten_strings(doc_dict)
    return '\n'.join(fallback_lines)


def flatten_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []

    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(flatten_strings(item))
        return out

    if isinstance(value, dict):
        out: list[str] = []
        for item in value.values():
            out.extend(flatten_strings(item))
        return out

    return []


def convert_pages(page_inputs: list[dict[str, Any]]) -> dict[str, Any]:
    model_label, converter = build_converter()
    pages: list[dict[str, Any]] = []

    for page_input in page_inputs:
        page_number = page_input['page']
        image_path = page_input['path']
        conversion = converter.convert(source=image_path)
        doc = conversion.document
        doc_dict = doc.export_to_dict()
        markdown = export_page_markdown(doc, doc_dict)
        pages.append(
            {
                'page': page_number,
                'markdown': markdown,
                'document': doc_dict,
            }
        )

    return {
        'model': model_label,
        'pages': pages,
    }


def parse_input(raw: str) -> list[dict[str, Any]]:
    payload = json.loads(raw)
    if not isinstance(payload, list) or not payload:
        raise ValueError('Input must be a non-empty JSON array of {page, path} objects.')

    pages: list[dict[str, Any]] = []
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(f'Item {index} must be an object.')

        page = item.get('page')
        path = item.get('path')
        if not isinstance(page, int):
            raise ValueError(f'Item {index} is missing a valid integer page number.')
        if not isinstance(path, str) or not path.strip():
            raise ValueError(f'Item {index} is missing a valid image path.')

        pages.append({'page': page, 'path': path})

    return pages


def main() -> int:
    try:
        page_inputs = parse_input(sys.stdin.read())
        result = convert_pages(page_inputs)
        sys.stdout.write(json.dumps(result))
        sys.stdout.flush()
        return 0
    except Exception as exc:
        sys.stderr.write(str(exc))
        sys.stderr.flush()
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
