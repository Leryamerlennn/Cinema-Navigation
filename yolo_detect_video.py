#!/usr/bin/env python
import argparse
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "YOLO детекция объектов на webm-видео: "
            "читает .webm, сохраняет новое видео с боксами/лейблами."
        )
    )
    parser.add_argument(
        "input_video",
        type=str,
        help="Путь к входному .webm видео (с рендера сцены).",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help=(
            "Путь к выходному видео. "
            "Если не указан, будет создан файл с суффиксом '_yolo.mp4' рядом с входным."
        ),
    )
    parser.add_argument(
        "--model",
        type=str,
        default="yolov8n.pt",
        help=(
            "Путь или имя YOLO модели Ultralytics. "
            "По умолчанию 'yolov8n.pt' (самая лёгкая)."
        ),
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.25,
        help="Порог уверенности для детекции (по умолчанию 0.25).",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cpu",
        help="Устройство: 'cpu' или 'cuda' (если есть GPU). По умолчанию 'cpu'.",
    )
    return parser.parse_args()


def create_output_path(input_path: Path, output_str: str | None) -> Path:
    if output_str is not None:
        return Path(output_str).resolve()

    # по умолчанию: inputName_yolo.mp4 рядом с исходником
    stem = input_path.stem
    parent = input_path.parent
    return (parent / f"{stem}_yolo.mp4").resolve()


def load_model(model_path: str, device: str) -> YOLO:
    try:
        model = YOLO(model_path)
        model.to(device)
    except Exception as e:
        print(f"[ERROR] Не удалось загрузить модель YOLO: {e}", file=sys.stderr)
        sys.exit(1)
    return model


def open_video(input_path: Path):
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        print(f"[ERROR] Не удалось открыть видео: {input_path}", file=sys.stderr)
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        # fallback, если контейнер не хранит fps
        fps = 25.0

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"[INFO] Открыто видео: {input_path}")
    print(f"       Разрешение: {width}x{height}, FPS: {fps:.2f}, кадров: {frame_count}")

    return cap, fps, width, height, frame_count


def create_writer(
    output_path: Path, fps: float, width: int, height: int
) -> cv2.VideoWriter:
    # Используем mp4 с кодеком H.264 (если доступен).
    # Если не работает, можно заменить FourCC на 'VP90' и расширение на .webm.
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(
        str(output_path),
        fourcc,
        fps,
        (width, height),
    )
    if not writer.isOpened():
        print(f"[ERROR] Не удалось создать видеофайл: {output_path}", file=sys.stderr)
        sys.exit(1)

    print(f"[INFO] Выходное видео: {output_path}")
    return writer


def draw_detections(frame: np.ndarray, results, class_names: dict[int, str]):
    """
    Рисуем детекции YOLO на кадре.
    results.boxes.xyxy: [N, 4]  (x1, y1, x2, y2)
    results.boxes.conf: [N]
    results.boxes.cls:  [N]
    """
    boxes = results.boxes
    if boxes is None or boxes.xyxy is None:
        return frame

    xyxy = boxes.xyxy.cpu().numpy()
    confidences = boxes.conf.cpu().numpy()
    classes = boxes.cls.cpu().numpy().astype(int)

    for (x1, y1, x2, y2), conf, cls_id in zip(xyxy, confidences, classes):
        x1, y1, x2, y2 = map(int, [x1, y1, x2, y2])
        label = class_names.get(cls_id, str(cls_id))
        text = f"{label} {conf:.2f}"

        # Прямоугольник
        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

        # Подложка под текст
        (text_w, text_h), baseline = cv2.getTextSize(
            text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1
        )
        cv2.rectangle(
            frame,
            (x1, y1 - text_h - baseline),
            (x1 + text_w, y1),
            (0, 255, 0),
            thickness=-1,
        )

        cv2.putText(
            frame,
            text,
            (x1, y1 - baseline),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 0, 0),
            1,
            cv2.LINE_AA,
        )

    return frame


def process_video(
    input_path: Path,
    output_path: Path,
    model: YOLO,
    conf_thres: float,
):
    cap, fps, width, height, frame_count = open_video(input_path)
    writer = create_writer(output_path, fps, width, height)

    class_names = model.model.names if hasattr(model, "model") else model.names

    frame_idx = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # YOLO ожидает BGR → это уже BGR из OpenCV
            # Запускаем детекцию
            results = model.predict(
                source=frame,
                conf=conf_thres,
                verbose=False,
            )
            # results — список, берём первый элемент
            res = results[0]

            # Рисуем детекции
            frame_out = draw_detections(frame, res, class_names)

            # Пишем кадр
            writer.write(frame_out)

            frame_idx += 1
            if frame_idx % 50 == 0:
                print(f"[INFO] Обработано кадров: {frame_idx}/{frame_count}")
    finally:
        cap.release()
        writer.release()

    print(f"[INFO] Готово. Детектированное видео сохранено в: {output_path}")


def main():
    args = parse_args()

    input_path = Path(args.input_video).resolve()
    if not input_path.is_file():
        print(f"[ERROR] Файл не найден: {input_path}", file=sys.stderr)
        sys.exit(1)

    if input_path.suffix.lower() != ".webm":
        print(
            f"[WARN] Входной файл не .webm (расширение: {input_path.suffix}), "
            f"но продолжим. Убедитесь, что это видеофайл.",
        )

    output_path = create_output_path(input_path, args.output)
    os.makedirs(output_path.parent, exist_ok=True)

    print(f"[INFO] Используем модель: {args.model} (device={args.device})")
    model = load_model(args.model, args.device)

    process_video(
        input_path=input_path,
        output_path=output_path,
        model=model,
        conf_thres=args.confidence,
    )


if __name__ == "__main__":
    main()
