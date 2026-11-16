"""Three UART/I2C boot checks for the normal-mode comparison image.
Requires DK USB attached; keep PPK output off. No PPK hardware access.
"""
from pathlib import Path
import importlib.util
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('boot_check',root.parent/'closed-loop'/'verify_bme_boots.py')
check=importlib.util.module_from_spec(spec);spec.loader.exec_module(check)
check.OUT=root/'normal-usb-boots'
check.OUT.mkdir(exist_ok=False)
check.main()
