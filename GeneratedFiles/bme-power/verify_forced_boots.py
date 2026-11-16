"""Reuse the existing three-boot UART/I2C checks without overwriting baseline evidence.
Requires DK USB attached; PPK output must remain off. No PPK commands here.
"""
from pathlib import Path
import importlib.util
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('boot_check',root.parent/'closed-loop'/'verify_bme_boots.py')
check=importlib.util.module_from_spec(spec);spec.loader.exec_module(check)
check.OUT=root/'forced-usb-boots'
check.OUT.mkdir(exist_ok=False)
check.main()
