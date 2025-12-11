        // ====== НАЧАЛО: Класс для кэширования рисования ======
        class DrawingBuffer {
            constructor(socket, boardId) {
                this.socket = socket;
                this.boardId = boardId;
                this.localBuffer = [];
                this.batchSize = 10;
                this.batchInterval = 100;
                this.isOnline = true;
                this.lastServerTime = 0;
                this.latency = 0;
                this.batchTimer = null;
                this.pingInterval = null;
                
                this.setupEventListeners();
            }
            
            setupEventListeners() {
                // Отправка пакетов только если есть данные
                this.batchTimer = setInterval(() => {
                    if (this.localBuffer.length > 0 && this.isOnline) {
                        this.sendBatch();
                    }
                }, this.batchInterval);
                
                // Пинг для проверки лага
                this.pingInterval = setInterval(() => {
                    if (this.isOnline) {
                        this.socket.emit('ping_drawing', {
                            client_time: Date.now() / 1000
                        }, (response) => {
                            if (response && response.latency) {
                                this.latency = response.latency;
                                this.adjustBatchSize();
                            }
                        });
                    }
                }, 5000);
            }
            
            addDrawing(drawingData) {
                // Добавляем временную метку и ID
                drawingData.client_timestamp = Date.now() / 1000;
                drawingData.id = `draw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                // Сохраняем в локальный буфер
                this.localBuffer.push(drawingData);
                
                // Немедленно отображаем локально
                this.drawLocally(drawingData);
                
                // Если буфер переполнен, отправляем немедленно
                if (this.localBuffer.length >= 50) {
                    this.sendBatch();
                }
            }
            
            sendBatch() {
                if (this.localBuffer.length === 0 || !this.isOnline) return;
                
                const batch = [...this.localBuffer];
                this.localBuffer = [];
                
                this.socket.emit('batch_drawing', {
                    drawings: batch,
                    batch_id: `batch_${Date.now()}`,
                    board_id: this.boardId
                }, (response) => {
                    if (response && response.status === 'ok') {
                        console.log(`Отправлен пакет: ${response.count} рисунков`);
                    } else {
                        // Возвращаем в буфер при ошибке
                        this.localBuffer = [...batch, ...this.localBuffer];
                        console.warn('Ошибка отправки пакета, возвращаем в буфер');
                    }
                });
            }
            
            drawLocally(drawingData) {
                // Рисуем локально на основном холсте
                ctx.beginPath();
                ctx.lineWidth = drawingData.brushSize || currentBrushSize;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                
                if (drawingData.type === 'eraser') {
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.strokeStyle = 'rgba(0,0,0,1)';
                } else {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.strokeStyle = drawingData.color || currentColor;
                }
                
                ctx.moveTo(drawingData.lastX, drawingData.lastY);
                ctx.lineTo(drawingData.x, drawingData.y);
                ctx.stroke();
                ctx.closePath();
            }
            
            adjustBatchSize() {
                // Настройка размера пакета в зависимости от лага
                if (this.latency > 0.5) { // Высокий лаг
                    this.batchSize = 20;
                    this.batchInterval = 200;
                } else if (this.latency > 0.2) { // Средний лаг
                    this.batchSize = 15;
                    this.batchInterval = 150;
                } else { // Низкий лаг
                    this.batchSize = 10;
                    this.batchInterval = 100;
                }
                
                // Перезапускаем таймер
                if (this.batchTimer) {
                    clearInterval(this.batchTimer);
                }
                this.batchTimer = setInterval(() => {
                    if (this.localBuffer.length > 0 && this.isOnline) {
                        this.sendBatch();
                    }
                }, this.batchInterval);
            }
            
            destroy() {
                // Отправляем оставшиеся данные
                if (this.localBuffer.length > 0) {
                    this.sendBatch();
                }
                
                // Очищаем таймеры
                if (this.batchTimer) {
                    clearInterval(this.batchTimer);
                }
                if (this.pingInterval) {
                    clearInterval(this.pingInterval);
                }
                
                this.localBuffer = [];
            }
        }
        // ====== КОНЕЦ: Класс для кэширования рисования ======        
        // Получаем board_id из URL
        const urlParams = new URLSearchParams(window.location.search);
        let boardId = urlParams.get('id');
        
        if (!boardId) {
            window.location.href = '/';
        }
        
        // Отображаем ID доски
        document.getElementById('boardIdDisplay').textContent = boardId;
        
        // Инициализация WebSocket соединения с передачей board_id
        const socket = io({
            query: { board_id: boardId }
        });
        // Вставьте этот код после создания socket соединения:
        // const socket = io({ query: { board_id: boardId } });

        // Инициализация буфера рисования
        let drawingBuffer = null;

        // Создаем буфер после подключения
        socket.on('connect', () => {
            console.log('Подключено к серверу, доска ID:', boardId);
            connectionStatus.className = 'status connected';
            connectionStatus.innerHTML = '<i class="fas fa-wifi"></i> Подключено к серверу';
            showNotification('Подключено к доске', 'success');
            
            // Инициализируем буфер рисования
            if (!drawingBuffer) {
                drawingBuffer = new DrawingBuffer(socket, boardId);
            }
        });

        socket.on('disconnect', () => {
            console.log('Отключено от сервера');
            connectionStatus.className = 'status disconnected';
            connectionStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Отключено от сервера';
            showNotification('Отключено от сервера', 'error');
            
            // Очищаем буфер при отключении
            if (drawingBuffer) {
                drawingBuffer.isOnline = false;
            }
        });        
        
        // Элементы DOM
        const canvas = document.getElementById('drawingCanvas');
        const ctx = canvas.getContext('2d');
        const previewCanvas = document.getElementById('previewCanvas');
        const previewCtx = previewCanvas.getContext('2d');
        const formulaOverlay = document.getElementById('formulaOverlay');
        const textOverlay = document.getElementById('textOverlay');
        const latexInput = document.getElementById('latexInput');
        const textInput = document.getElementById('textInput');
        const formulaPreview = document.getElementById('formulaPreview');
        const addFormulaBtn = document.getElementById('addFormulaBtn');
        const clearFormulaBtn = document.getElementById('clearFormulaBtn');
        const addTextBtn = document.getElementById('addTextBtn');
        const clearTextBtn = document.getElementById('clearTextBtn');
        const clearBtn = document.getElementById('clearBtn');
        const undoBtn = document.getElementById('undoBtn');
        const saveBtn = document.getElementById('saveBtn');
        const colorOptions = document.querySelectorAll('.color-option');
        const brushSizes = document.querySelectorAll('.brush-size');
        const usersList = document.getElementById('usersList');
        const usersCount = document.getElementById('usersCount');
        const liveUsersCount = document.getElementById('liveUsersCount');
        const connectionStatus = document.getElementById('connectionStatus');
        const textSizeSelect = document.getElementById('textSizeSelect');
        const textFontSelect = document.getElementById('textFontSelect');
        const boardIdDisplay = document.getElementById('boardIdDisplay');
        const copyLinkBtn = document.getElementById('copyLinkBtn');
        const newBoardBtn = document.getElementById('newBoardBtn');

        //Тачскрин
        let initialPinchDistance = 0;
        let isPinching = false;
        let initialWidthOnPinch = 0;
        let initialHeightOnPinch = 0;
        let initialShapeCenterOnPinch = null;    
        // Элементы режимов
        const drawModeBtn = document.getElementById('drawModeBtn');
        const shapeModeBtn = document.getElementById('shapeModeBtn');
        const formulaModeBtn = document.getElementById('formulaModeBtn');
        const textModeBtn = document.getElementById('textModeBtn');
        const imageModeBtn = document.getElementById('imageModeBtn');
        const drawingPanel = document.getElementById('drawingPanel');
        const shapesPanel = document.getElementById('shapesPanel');
        const formulasPanel = document.getElementById('formulasPanel');
        const textPanel = document.getElementById('textPanel');
        const imagePanel = document.getElementById('imagePanel');
        const shapeButtons = document.querySelectorAll('.shape-btn');
        const shapeInfo = document.getElementById('shapeInfo');
        const imageUpload = document.getElementById('imageUpload');
        const addImageBtn = document.getElementById('addImageBtn');
        
        // Элементы управления вращением
        const rotationControls = document.getElementById('rotationControls');
        const rotateLeftBtn = document.getElementById('rotateLeftBtn');
        const rotateRightBtn = document.getElementById('rotateRightBtn');
        const resetRotationBtn = document.getElementById('resetRotationBtn');
        
        // Для вращения фигур
        let isRotatingShape = false;
        let rotateStartAngle = 0;
        let rotateStartMouseAngle = 0;
        // График
        // Элементы для графика
        const graphModeBtn = document.getElementById('graphModeBtn');
        const graphPanel = document.getElementById('graphPanel');
        const graphFunction = document.getElementById('graphFunction');
        const graphXMin = document.getElementById('graphXMin');
        const graphXMax = document.getElementById('graphXMax');
        const graphYMin = document.getElementById('graphYMin');
        const graphYMax = document.getElementById('graphYMax');
        const graphColor = document.getElementById('graphColor');
        const graphLineWidth = document.getElementById('graphLineWidth');
        const graphPreview = document.getElementById('graphPreview');
        const plotGraphBtn = document.getElementById('plotGraphBtn');
        const clearGraphBtn = document.getElementById('clearGraphBtn');

        // Для хранения графиков
        let graphs = [];
        let selectedGraph = null;
        let isDraggingGraph = false;
        let graphDragOffsetX = 0;
        let graphDragOffsetY = 0;        
        // Инициализация canvas с правильными размерами
        function initCanvas() {
            const container = canvas.parentElement;
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            previewCanvas.width = container.clientWidth;
            previewCanvas.height = container.clientHeight;
            
            // Очищаем canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        }
        
        initCanvas();
        
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                initCanvas();
                redrawAll();
            }, 100);
        });
        // Очистка при закрытии страницы
        window.addEventListener('beforeunload', () => {
            if (drawingBuffer) {
                drawingBuffer.destroy();
            }
        });        
        
        // Начальные настройки рисования
        let currentColor = '#000000';
        let currentBrushSize = 5;
        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;
        
        // Для управления элементами
        let formulas = []; // Массив для хранения объектов формул
        let texts = [];    // Массив для хранения объектов текста
        let shapes = [];   // Массив для хранения объектов фигур
        let drawings = []; // Массив для хранения объектов рисунков
        let images = [];   // Массив для хранения объектов изображений
        
        let selectedElement = null;
        let isDraggingElement = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        
        let uploadedImageData = null;
        let selectedImage = null;
        let isDraggingImage = false;
        let imageDragOffsetX = 0;
        let imageDragOffsetY = 0;
        
        let selectedShape = null;
        let isDraggingShape = false;
        let shapeDragOffsetX = 0;
        let shapeDragOffsetY = 0;
        
        // Для рисования фигур
        let currentMode = 'draw';
        let currentShape = null;
        let isDrawingShape = false;
        let shapeStartX = 0;
        let shapeStartY = 0;
        
        // Настройки текста по умолчанию
        let currentTextSize = '16px';
        let currentTextFont = 'Arial, sans-serif';
        
        // Функция для показа уведомлений
        function showNotification(message, type = 'info') {
            const existingNotification = document.querySelector('.notification');
            if (existingNotification) {
                existingNotification.remove();
            }
            
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            notification.innerHTML = `
                <div>${message}</div>
                <button onclick="this.parentElement.remove()">×</button>
            `;
            
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 3000);
        }
        
        // Функция для вычисления расстояния между двумя точками
        function getDistance(touch1, touch2) {
            const dx = touch1.clientX - touch2.clientX;
            const dy = touch1.clientY - touch2.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }
        
        // Копирование ссылки на доску с fallback
        function copyBoardLink() {
            const url = `${window.location.origin}${window.location.pathname}?id=${boardId}`;
            
            // Проверяем доступность Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(() => {
                    showNotification('Ссылка на доску скопирована в буфер обмена!', 'success');
                }).catch(err => {
                    // Если Clipboard API не сработал, используем fallback
                    fallbackCopyText(url);
                    console.warn('Clipboard API ошибка, использован fallback:', err);
                });
            } else {
                // Используем старый метод для браузеров без Clipboard API
                fallbackCopyText(url);
            }
        }
        
        // Копирование ID доски с fallback
        function copyBoardId() {
            // Проверяем доступность Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(boardId).then(() => {
                    showNotification('ID доски скопирован в буфер обмена!', 'success');
                }).catch(err => {
                    fallbackCopyText(boardId);
                    console.warn('Clipboard API ошибка, использован fallback:', err);
                });
            } else {
                fallbackCopyText(boardId);
            }
        }
        
        // Fallback метод для копирования
        function fallbackCopyText(text) {
            try {
                // Создаем временный textarea
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                
                // Выделяем и копируем
                textArea.focus();
                textArea.select();
                
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                
                if (successful) {
                    showNotification('Ссылка на доску скопирована в буфер обмена!', 'success');
                } else {
                    throw new Error('Не удалось скопировать');
                }
            } catch (err) {
                // Показываем пользователю ссылку для ручного копирования
                showNotification('Нажмите Ctrl+C, чтобы скопировать ссылку: ' + text, 'info');
                console.error('Ошибка копирования:', err);
            }
        }
        
        // Переключение режимов
        // Инициализация буфера рисования


        // Создаем буфер только для режима рисования
        function initDrawingBuffer() {
            if (currentMode === 'draw') {
                if (!drawingBuffer) {
                    drawingBuffer = new DrawingBuffer(socket, boardId);
                }
            } else {
                // Уничтожаем буфер при переключении на другой режим
                if (drawingBuffer) {
                    drawingBuffer.destroy();
                    drawingBuffer = null;
                }
            }
        }

        // Обновите функцию setMode:
 function setMode(mode) {
    currentMode = mode;
    
    drawModeBtn.classList.toggle('active', mode === 'draw');
    shapeModeBtn.classList.toggle('active', mode === 'shape');
    formulaModeBtn.classList.toggle('active', mode === 'formula');
    textModeBtn.classList.toggle('active', mode === 'text');
    imageModeBtn.classList.toggle('active', mode === 'image');
    graphModeBtn.classList.toggle('active', mode === 'graph'); // Добавьте эту строку
    
    drawingPanel.style.display = mode === 'draw' ? 'block' : 'none';
    shapesPanel.style.display = mode === 'shape' ? 'block' : 'none';
    formulasPanel.style.display = mode === 'formula' ? 'block' : 'none';
    textPanel.style.display = mode === 'text' ? 'block' : 'none';
    imagePanel.style.display = mode === 'image' ? 'block' : 'none';
    graphPanel.style.display = mode === 'graph' ? 'block' : 'none'; // Добавьте эту строку
    
    // Инициализируем или уничтожаем буфер рисования
    initDrawingBuffer();
    
    if (currentMode !== mode) {
        isDrawing = false;
        isDrawingShape = false;
        isDraggingShape = false;
        isDraggingImage = false;
        isDraggingElement = false;
        isDraggingGraph = false;
        
        // Скрываем превью для фигур
        if (previewCanvas) {
            previewCanvas.style.display = 'none';
            previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
        }
    }
    
    if (mode === 'draw') {
        canvas.style.cursor = 'crosshair';
        ctx.globalCompositeOperation = 'source-over';
    } else if (mode === 'shape') {
        canvas.style.cursor = currentShape ? 'crosshair' : 'default';
        shapeInfo.textContent = currentShape 
            ? `Выбрано: ${getShapeName(currentShape)}` 
            : 'Выберите фигуру и рисуйте на холсте';
        ctx.globalCompositeOperation = 'source-over';
        updateRotationControls();
    } else if (mode === 'image') {
        canvas.style.cursor = 'move';
    } else if (mode === 'graph') {
        canvas.style.cursor = 'move';
        // Создаем предварительный просмотр графика
        updateGraphPreview();
    } else {
        canvas.style.cursor = 'default';
    }
}
        
        // Получение имени фигуры
        function getShapeName(shape) {
            const shapeNames = {
                'line': 'Прямая',
                'circle': 'Круг',
                'square': 'Квадрат',
                'rectangle': 'Прямоугольник',
                'triangle': 'Треугольник',
                'equilateral': 'Равносторонний треугольник',
                'right': 'Прямоугольный треугольник',
                'isosceles': 'Равнобедренный треугольник',
                'obtuse': 'Тупоугольный треугольник',
                'diamond': 'Ромб',
                'arrow': 'Стрелка',
                'cube': 'Куб',
                'parallelepiped': 'Параллелепипед',
                'pyramid': 'Пирамида',
        'trapezoid': 'Трапеция',
        'ellipse': 'Эллипс',
        'hexagon': 'Шестиугольник'                
            };
            return shapeNames[shape] || 'Фигура';
        }
        
        // Выбор фигуры
        shapeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                shapeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentShape = btn.dataset.shape;
                shapeInfo.textContent = `Выбрано: ${getShapeName(currentShape)}`;
                setMode('shape');
            });
        });
        
        // Переключатели режимов
        drawModeBtn.addEventListener('click', () => setMode('draw'));
        shapeModeBtn.addEventListener('click', () => setMode('shape'));
        formulaModeBtn.addEventListener('click', () => setMode('formula'));
        textModeBtn.addEventListener('click', () => setMode('text'));
        imageModeBtn.addEventListener('click', () => setMode('image'));
        graphModeBtn.addEventListener('click', () => setMode('graph'));
// Обработчики событий для предпросмотра графика
graphFunction.addEventListener('input', updateGraphPreview);
graphXMin.addEventListener('input', updateGraphPreview);
graphXMax.addEventListener('input', updateGraphPreview);
graphYMin.addEventListener('input', updateGraphPreview);
graphYMax.addEventListener('input', updateGraphPreview);
graphColor.addEventListener('input', updateGraphPreview);
graphLineWidth.addEventListener('input', updateGraphPreview);

// Обработчик кнопки построения графика
plotGraphBtn.addEventListener('click', async () => {
    const funcStr = graphFunction.value.trim();
    if (!funcStr) {
        showNotification('Введите функцию', 'error');
        return;
    }
    
    const xMin = parseFloat(graphXMin.value);
    const xMax = parseFloat(graphXMax.value);
    const yMin = parseFloat(graphYMin.value);
    const yMax = parseFloat(graphYMax.value);
    
    if (isNaN(xMin) || isNaN(xMax) || xMin >= xMax) {
        showNotification('Укажите корректный диапазон X', 'error');
        return;
    }
    
    if (isNaN(yMin) || isNaN(yMax) || yMin >= yMax) {
        showNotification('Укажите корректный диапазон Y', 'error');
        return;
    }
    
    const graphData = {
        function: funcStr,
        xMin: xMin,
        xMax: xMax,
        yMin: yMin,
        yMax: yMax,
        color: graphColor.value,
        lineWidth: parseInt(graphLineWidth.value),
        x: canvas.width / 2 - 300,
        y: canvas.height / 2 - 200,
        width: 600,
        height: 400
    };
    
    await addGraphToCanvas(graphData);
    
    // Очищаем поля
    graphFunction.value = '';
    graphPreview.innerHTML = '';
});

// Обработчик кнопки очистки
clearGraphBtn.addEventListener('click', () => {
    graphFunction.value = '';
    graphXMin.value = '-10';
    graphXMax.value = '10';
    graphYMin.value = '-5';
    graphYMax.value = '5';
    graphColor.value = '#ff0000';
    graphLineWidth.value = '2';
    graphPreview.innerHTML = '';
});        
        
        // Обновление предпросмотра формулы
        function updateFormulaPreview() {
            const latex = latexInput.value.trim();
            if (latex) {
                try {
                    formulaPreview.innerHTML = `<div class="latex-output">\\(${latex}\\)</div>`;
                    if (MathJax.typesetPromise) {
                        MathJax.typesetPromise([formulaPreview]).catch(err => {
                            formulaPreview.innerHTML = `<div style="color: #f44336;">${latex}</div>`;
                        });
                    }
                } catch (err) {
                    formulaPreview.innerHTML = `<div style="color: #f44336;">${latex}</div>`;
                }
            } else {
                formulaPreview.innerHTML = '<div class="latex-output">Введите формулу для предпросмотра</div>';
            }
        }
        
        // Вставка примера формулы
        window.insertExample = function(example) {
            latexInput.value = example;
            updateFormulaPreview();
            setMode('formula');
        };
        
        // Вставка примера текста
        window.insertTextExample = function(example) {
            textInput.value = example;
            setMode('text');
        };

// Функция для вставки примера графика
window.insertGraphExample = function(example) {
    graphFunction.value = example;
    updateGraphPreview();
    setMode('graph');
};

// Функция обновления предпросмотра графика
function updateGraphPreview() {
    const funcStr = graphFunction.value.trim();
    if (!funcStr) return;
    
    try {
        const xMin = parseFloat(graphXMin.value) || -10;
        const xMax = parseFloat(graphXMax.value) || 10;
        const yMin = parseFloat(graphYMin.value) || -5;
        const yMax = parseFloat(graphYMax.value) || 5;
        const color = graphColor.value;
        const lineWidth = parseInt(graphLineWidth.value);
        
        // Генерируем данные для графика
        const xValues = [];
        const yValues = [];
        const step = (xMax - xMin) / 100;
        
        for (let x = xMin; x <= xMax; x += step) {
            try {
                // Заменяем ^ на ** для математических выражений
                const scope = { x: x };
                let expr = funcStr
                    // .replace(/\^/g, '**')
                    // .replace(/\s+/g, '') // Удаляем пробелы
                    // .replace(/ln\(/g, 'log(') // Преобразуем ln в log
                    // .replace(/sqrt\(/g, 'sqrt('); // Поддержка sqrt
                // Вычисляем значение функции
                const y = math.evaluate(expr, scope);
                
                // Проверяем, что значение в пределах разумного
                if (isFinite(y) && Math.abs(y) < 1e6) {
                    xValues.push(x);
                    yValues.push(y);
                }
            } catch (err) {
                console.error('Ошибка вычисления:', err);
            }
        }
        
        const trace = {
            x: xValues,
            y: yValues,
            mode: 'lines',
            line: {
                color: color,
                width: lineWidth
            },
            name: funcStr
        };
        
        const layout = {
            width: graphPreview.clientWidth,
            height: graphPreview.clientHeight,
            margin: { t: 20, r: 20, b: 40, l: 40 },
            paper_bgcolor: 'rgba(0, 0, 0, 0)',
            plot_bgcolor: 'rgba(0, 0, 0, 0)',
            xaxis: {
                title: 'x',
                range: [xMin, xMax]
            },
            yaxis: {
                title: 'f(x)',
                range: [yMin, yMax]
            },
            showlegend: false
        };
        
        Plotly.newPlot(graphPreview, [trace], layout, {displayModeBar: true}, );
        
    } catch (err) {
        console.error('Ошибка построения графика:', err);
        graphPreview.innerHTML = `<div style="color: #f44336; text-align: center; padding: 20px;">
            Ошибка: ${err.message}</div>`;
    }
}

// Функция для создания изображения из графика
async function createGraphImage(graphData) {
    return new Promise((resolve) => {
        const funcStr = graphData.function;
        const xMin = graphData.xMin;
        const xMax = graphData.xMax;
        const yMin = graphData.yMin;
        const yMax = graphData.yMax;
        const color = graphData.color;
        const lineWidth = graphData.lineWidth;
        
        // Генерируем данные для графика
        const xValues = [];
        const yValues = [];
        const step = (xMax - xMin) / 200;
        
        for (let x = xMin; x <= xMax; x += step) {
            try {
                const scope = { x: x };
                let expr = funcStr
                    .replace(/\^/g, '**')
                    .replace(/\s+/g, '') // Удаляем пробелы
                    .replace(/ln\(/g, 'log(') // Преобразуем ln в log
                    .replace(/sqrt\(/g, 'sqrt('); // Поддержка sqrt
                // Вычисляем значение функции
                const y = math.evaluate(expr, scope);
                
                if (isFinite(y) && Math.abs(y) < 1e6) {
                    xValues.push(x);
                    yValues.push(y);
                }
            } catch (err) {
                // Пропускаем ошибки вычисления
            }
        }
        
        const trace = {
            x: xValues,
            y: yValues,
            mode: 'lines',
            line: {
                color: color,
                width: lineWidth
            },
            name: funcStr
        };
        
        const layout = {
            width: 600,
            height: 400,
            margin: { t: 20, r: 20, b: 40, l: 40 },
            paper_bgcolor: 'white',
            plot_bgcolor: 'white',
            xaxis: {
                title: 'x',
                range: [xMin, xMax],
                showgrid: true,
                gridcolor: '#eee'
            },
            yaxis: {
                title: 'f(x)',
                range: [yMin, yMax],
                showgrid: true,
                gridcolor: '#eee'
            },
            showlegend: false
        };
        
        // Создаем временный div для графика
        const tempDiv = document.createElement('div');
        tempDiv.style.width = '600px';
        tempDiv.style.height = '400px';
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        document.body.appendChild(tempDiv);
        
        Plotly.newPlot(tempDiv, [trace], layout, {displayModeBar: false}).then(() => {
            // Преобразуем график в изображение
            Plotly.toImage(tempDiv, {format: 'png', width: 600, height: 400}).then((dataUrl) => {
                document.body.removeChild(tempDiv);
                resolve(dataUrl);
            });
        });
    });
}

// Функция добавления графика на холст
async function addGraphToCanvas(graphData) {
    try {
        // Создаем изображение графика
        const imageUrl = await createGraphImage(graphData);
        
        const img = new Image();
        img.onload = function() {
            const graphObj = {
                img: img,
                x: graphData.x || canvas.width / 2 - 300,
                y: graphData.y || canvas.height / 2 - 200,
                width: graphData.width || 600,
                height: graphData.height || 400,
                id: graphData.id || 'graph_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                type: 'graph',
                function: graphData.function,
                xMin: graphData.xMin,
                xMax: graphData.xMax,
                yMin: graphData.yMin,
                yMax: graphData.yMax,
                color: graphData.color,
                lineWidth: graphData.lineWidth
            };
            
            graphs.push(graphObj);
            redrawAll();
            
            // Отправляем на сервер только если это локальный график
            if (!graphData.fromServer) {
                // Отправляем все данные графика
                socket.emit('add_graph', {
                    id: graphObj.id,
                    x: graphObj.x,
                    y: graphObj.y,
                    width: graphObj.width,
                    height: graphObj.height,
                    function: graphObj.function,
                    xMin: graphObj.xMin,
                    xMax: graphObj.xMax,
                    yMin: graphObj.yMin,
                    yMax: graphObj.yMax,
                    color: graphObj.color,
                    lineWidth: graphObj.lineWidth,
                    imageUrl: imageUrl // Отправляем также изображение для быстрой загрузки
                });
            }
            
            showNotification('График добавлен на доску', 'success');
        };
        
        img.onerror = function() {
            console.error('Ошибка загрузки изображения графика');
            showNotification('Ошибка создания графика', 'error');
        };
        
        img.src = imageUrl;
        
    } catch (err) {
        console.error('Ошибка создания графика:', err);
        showNotification('Ошибка создания графика', 'error');
    }
}

// Проверка попадания на график
function hitGraph(x, y) {
    return graphs.find(graph =>
        x >= graph.x &&
        x <= graph.x + graph.width &&
        y >= graph.y &&
        y <= graph.y + graph.height
    );
}

// Функция для обновления позиции графика
function updateGraphPosition(graphId, x, y, width, height) {
    const graph = graphs.find(g => g.id === graphId);
    if (graph) {
        graph.x = x;
        graph.y = y;
        if (width) graph.width = width;
        if (height) graph.height = height;
        redrawAll();
    }
}        
        // Функция для получения правильных координат мыши и касания на canvas
        // Обновленная функция для получения координат
        function getCanvasCoordinates(e) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            
            let clientX, clientY;
            
            if (e.clientX !== undefined) {
                // Событие мыши или объект с clientX/clientY
                clientX = e.clientX;
                clientY = e.clientY;
            } else if (e.touches && e.touches.length > 0) {
                // Событие касания
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else if (e.changedTouches && e.changedTouches.length > 0) {
                // Событие окончания касания
                clientX = e.changedTouches[0].clientX;
                clientY = e.changedTouches[0].clientY;
            } else {
                return { x: 0, y: 0 };
            }
            
            const x = (clientX - rect.left) * scaleX;
            const y = (clientY - rect.top) * scaleY;
            
            return { x, y };
        }
        
        // Проверка попадания на изображение
        function hitImage(x, y) {
            return images.find(img =>
                x >= img.x &&
                x <= img.x + img.width &&
                y >= img.y &&
                y <= img.y + img.height
            );
        }
        
        // Проверка попадания на фигуру или маркер вращения
        function hitShape(x, y) {
            for (let i = shapes.length - 1; i >= 0; i--) {
                const shape = shapes[i];
                
                // Вычисляем центр фигуры
                const centerX = (shape.x1 + shape.x2) / 2;
                const centerY = (shape.y1 + shape.y2) / 2;
                
                // Проверяем попадание на маркер вращения
                if (shape === selectedShape) {
                    const minX = Math.min(shape.x1, shape.x2);
                    const maxX = Math.max(shape.x1, shape.x2);
                    const minY = Math.min(shape.y1, shape.y2);
                    const maxY = Math.max(shape.y1, shape.y2);
                    const width = maxX - minX;
                    const height = maxY - minY;
                    const radius = Math.max(width, height) / 2 + 30;
                    
                    const markerX = centerX + radius * Math.cos(shape.rotation || 0);
                    const markerY = centerY + radius * Math.sin(shape.rotation || 0);
                    
                    // Проверяем попадание на маркер вращения (радиус 10px)
                    const distToMarker = Math.sqrt(Math.pow(x - markerX, 2) + Math.pow(y - markerY, 2));
                    if (distToMarker <= 10) {
                        return { shape: shape, type: 'rotate' };
                    }
                }
                
                // Простая проверка попадания в прямоугольную область фигуры
                const minX = Math.min(shape.x1, shape.x2);
                const maxX = Math.max(shape.x1, shape.x2);
                const minY = Math.min(shape.y1, shape.y2);
                const maxY = Math.max(shape.y1, shape.y2);
                
                // Расширяем область для лучшего захвата
                const padding = 10;
                
                if (x >= minX - padding && x <= maxX + padding && 
                    y >= minY - padding && y <= maxY + padding) {
                    return { shape: shape, type: 'drag' };
                }
            }
            return null;
        }
        
        // Функции для рисования фигур без вращения (для предпросмотра)
// Функции для новых фигур
function drawTrapezoid(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    
    // Трапеция с верхней стороной в 2 раза короче нижней
    const topWidth = width * 0.5;
    const topOffset = (width - topWidth) / 2;
    
    context.beginPath();
    context.moveTo(x, y + height); // левая нижняя
    context.lineTo(x + width, y + height); // правая нижняя
    context.lineTo(x + width - topOffset, y); // правая верхняя
    context.lineTo(x + topOffset, y); // левая верхняя
    context.closePath();
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
}



function drawEllipse(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;
    const radiusX = Math.abs(x2 - x1) / 2;
    const radiusY = Math.abs(y2 - y1) / 2;
    
    context.beginPath();
    
    // Используем метод эллипса, если доступен
    if (context.ellipse) {
        context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    } else {
        // Fallback для старых браузеров
        context.save();
        context.translate(centerX, centerY);
        context.scale(radiusX / radiusY, 1);
        context.arc(0, 0, radiusY, 0, Math.PI * 2);
        context.restore();
    }
    
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
}

function drawHexagon(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;
    const radius = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2;
    
    context.beginPath();
    
    // Рисуем правильный шестиугольник
    for (let i = 0; i < 6; i++) {
        const angle = (i * 2 * Math.PI) / 6 - Math.PI / 6; // Поворачиваем на 30 градусов
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        
        if (i === 0) {
            context.moveTo(x, y);
        } else {
            context.lineTo(x, y);
        }
    }
    
    context.closePath();
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
}

        function drawLine(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawCircle(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) / 2;
            
            context.beginPath();
            context.arc(centerX, centerY, radius, 0, Math.PI * 2);
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawSquare(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const size = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1));
            const x = x1 + (x2 > x1 ? 0 : -size);
            const y = y1 + (y2 > y1 ? 0 : -size);
            
            context.beginPath();
            context.rect(x, y, size, size);
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawRectangle(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const width = x2 - x1;
            const height = y2 - y1;
            
            context.beginPath();
            context.rect(x1, y1, width, height);
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawTriangle(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.lineTo(x1 + (x2 - x1) / 2, y1 - (y2 - y1) / 2);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawEquilateralTriangle(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const side = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            const height = side * Math.sqrt(3) / 2;
            
            const x3 = x1 + (x2 - x1) / 2;
            const y3 = y1 - height;
            
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.lineTo(x3, y3);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawRightTriangle(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y1);
            context.lineTo(x1, y2);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawIsoscelesTriangle(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const base = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);
            
            const x3 = (x1 + x2) / 2;
            const y3 = y1 - height;
            
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y1);
            context.lineTo(x3, y3);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawObtuseTriangle(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const x3 = x1 + (x2 - x1) * 0.3;
            const y3 = y1 - (y2 - y1) * 0.7;
            
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.lineTo(x3, y3);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawDiamond(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const width = Math.abs(x2 - x1) / 2;
            const height = Math.abs(y2 - y1) / 2;
            
            context.beginPath();
            context.moveTo(centerX, y1);
            context.lineTo(x2, centerY);
            context.lineTo(centerX, y2);
            context.lineTo(x1, centerY);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawArrow(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const headLength = Math.max(lineWidth * 3, 15);
            
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
            
            context.beginPath();
            context.moveTo(x2, y2);
            context.lineTo(
                x2 - headLength * Math.cos(angle - Math.PI / 6),
                y2 - headLength * Math.sin(angle - Math.PI / 6)
            );
            context.moveTo(x2, y2);
            context.lineTo(
                x2 - headLength * Math.cos(angle + Math.PI / 6),
                y2 - headLength * Math.sin(angle + Math.PI / 6)
            );
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawCube(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const width = Math.abs(x2 - x1);
            const height = width;
            const depth = Math.min(width, height) / 3;
            if (y1<0) y2 = y2 = y1 - width; else y2 = y1 + width
            
            context.beginPath();
            // Основание
            context.moveTo(x1, y1);
            context.lineTo(x2, y1);
            context.lineTo(x2, y2);
            context.lineTo(x1, y2);
            context.closePath();
            
            // Верхняя грань
            context.moveTo(x1 + depth, y1 - depth);
            context.lineTo(x2 + depth, y1 - depth);
            context.lineTo(x2 + depth, y2 - depth);
            context.lineTo(x1 + depth, y2 - depth);
            context.closePath();
            
            // Соединяющие линии
            context.moveTo(x1, y1);
            context.lineTo(x1 + depth, y1 - depth);
            
            context.moveTo(x2, y1);
            context.lineTo(x2 + depth, y1 - depth);
            
            context.moveTo(x2, y2);
            context.lineTo(x2 + depth, y2 - depth);
            
            context.moveTo(x1, y2);
            context.lineTo(x1 + depth, y2 - depth);
            
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawParallelepiped(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);
            const depth = Math.min(width, height) / 4;
            
            context.beginPath();
            // Основание
            context.moveTo(x1, y1);
            context.lineTo(x2, y1);
            context.lineTo(x2, y2);
            context.lineTo(x1, y2);
            context.closePath();
            
            // Верхняя грань
            context.moveTo(x1 + depth, y1 - depth);
            context.lineTo(x2 + depth, y1 - depth);
            context.lineTo(x2 + depth, y2 - depth);
            context.lineTo(x1 + depth, y2 - depth);
            context.closePath();
            
            // Соединяющие линии
            context.moveTo(x1, y1);
            context.lineTo(x1 + depth, y1 - depth);
            
            context.moveTo(x2, y1);
            context.lineTo(x2 + depth, y1 - depth);
            
            context.moveTo(x2, y2);
            context.lineTo(x2 + depth, y2 - depth);
            
            context.moveTo(x1, y2);
            context.lineTo(x1 + depth, y2 - depth);
            
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawPyramid(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const width = Math.abs(x2 - x1);
            const centerX = (x1 + x2) / 2;
            const topY = y1 - width / 2;
            
            context.beginPath();
            context.rect(x1, y1, width, width);
            
            context.moveTo(x1, y1);
            context.lineTo(centerX, topY);
            context.lineTo(x1 + width, y1);
            
            context.moveTo(x1 + width, y1);
            context.lineTo(centerX, topY);
            context.lineTo(x1 + width, y1 + width);
            
            context.moveTo(x1 + width, y1 + width);
            context.lineTo(centerX, topY);
            context.lineTo(x1, y1 + width);
            
            context.moveTo(x1, y1 + width);
            context.lineTo(centerX, topY);
            context.lineTo(x1, y1);
            
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }        
        
        // Повернутые версии функций рисования фигур
// Повернутые версии новых фигур
function drawTrapezoidRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    
    const topWidth = width * 0.5;
    const topOffset = (width - topWidth) / 2;
    
    context.beginPath();
    context.moveTo(x, y + height);
    context.lineTo(x + width, y + height);
    context.lineTo(x + width - topOffset, y);
    context.lineTo(x + topOffset, y);
    context.closePath();
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
}


function drawEllipseRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;
    const radiusX = Math.abs(x2 - x1) / 2;
    const radiusY = Math.abs(y2 - y1) / 2;
    
    context.beginPath();
    if (context.ellipse) {
        context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    } else {
        context.save();
        context.translate(centerX, centerY);
        context.scale(radiusX / radiusY, 1);
        context.arc(0, 0, radiusY, 0, Math.PI * 2);
        context.restore();
    }
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
}

function drawHexagonRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;
    const radius = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2;
    
    context.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (i * 2 * Math.PI) / 6 - Math.PI / 6;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        
        if (i === 0) {
            context.moveTo(x, y);
        } else {
            context.lineTo(x, y);
        }
    }
    context.closePath();
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
}

        function drawLineRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawCircleRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) / 2;
            
            context.beginPath();
            context.arc(centerX, centerY, radius, 0, Math.PI * 2);
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawSquareRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const size = Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1));
            const x = x1 + (x2 > x1 ? 0 : -size);
            const y = y1 + (y2 > y1 ? 0 : -size);
            
            context.beginPath();
            context.rect(x, y, size, size);
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawRectangleRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const width = x2 - x1;
            const height = y2 - y1;
            
            context.beginPath();
            context.rect(x1, y1, width, height);
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawTriangleRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.lineTo(x1 + (x2 - x1) / 2, y1 - (y2 - y1) / 2);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawEquilateralTriangleRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const side = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
            const height = side * Math.sqrt(3) / 2;
            
            const x3 = x1 + (x2 - x1) / 2;
            const y3 = y1 - height;
            
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.lineTo(x3, y3);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawRightTriangleRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y1);
            context.lineTo(x1, y2);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawIsoscelesTriangleRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const base = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);
            
            const x3 = (x1 + x2) / 2;
            const y3 = y1 - height;
            
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y1);
            context.lineTo(x3, y3);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawObtuseTriangleRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const x3 = x1 + (x2 - x1) * 0.3;
            const y3 = y1 - (y2 - y1) * 0.7;
            
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.lineTo(x3, y3);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawDiamondRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const width = Math.abs(x2 - x1) / 2;
            const height = Math.abs(y2 - y1) / 2;
            
            context.beginPath();
            context.moveTo(centerX, y1);
            context.lineTo(x2, centerY);
            context.lineTo(centerX, y2);
            context.lineTo(x1, centerY);
            context.closePath();
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawArrowRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const headLength = Math.max(lineWidth * 3, 15);
            
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
            
            context.beginPath();
            context.moveTo(x2, y2);
            context.lineTo(
                x2 - headLength * Math.cos(angle - Math.PI / 6),
                y2 - headLength * Math.sin(angle - Math.PI / 6)
            );
            context.moveTo(x2, y2);
            context.lineTo(
                x2 - headLength * Math.cos(angle + Math.PI / 6),
                y2 - headLength * Math.sin(angle + Math.PI / 6)
            );
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawCubeRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const width = Math.abs(x2 - x1);
            const height = width;
            const depth = Math.min(width, height) / 3;
            if (y1<0) y2 = y2 = y1 - width; else y2 = y1 + width
            
            context.beginPath();
            // Основание
            context.moveTo(x1, y1);
            context.lineTo(x2, y1);
            context.lineTo(x2, y2);
            context.lineTo(x1, y2);
            context.closePath();
            
            // Верхняя грань
            context.moveTo(x1 + depth, y1 - depth);
            context.lineTo(x2 + depth, y1 - depth);
            context.lineTo(x2 + depth, y2 - depth);
            context.lineTo(x1 + depth, y2 - depth);
            context.closePath();
            
            // Соединяющие линии
            context.moveTo(x1, y1);
            context.lineTo(x1 + depth, y1 - depth);
            
            context.moveTo(x2, y1);
            context.lineTo(x2 + depth, y1 - depth);
            
            context.moveTo(x2, y2);
            context.lineTo(x2 + depth, y2 - depth);
            
            context.moveTo(x1, y2);
            context.lineTo(x1 + depth, y2 - depth);
            
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawParallelepipedRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const width = Math.abs(x2 - x1);
            const height = Math.abs(y2 - y1);
            const depth = Math.min(width, height) / 4;
            
            context.beginPath();
            // Основание
            context.moveTo(x1, y1);
            context.lineTo(x2, y1);
            context.lineTo(x2, y2);
            context.lineTo(x1, y2);
            context.closePath();
            
            // Верхняя грань
            context.moveTo(x1 + depth, y1 - depth);
            context.lineTo(x2 + depth, y1 - depth);
            context.lineTo(x2 + depth, y2 - depth);
            context.lineTo(x1 + depth, y2 - depth);
            context.closePath();
            
            // Соединяющие линии
            context.moveTo(x1, y1);
            context.lineTo(x1 + depth, y1 - depth);
            
            context.moveTo(x2, y1);
            context.lineTo(x2 + depth, y1 - depth);
            
            context.moveTo(x2, y2);
            context.lineTo(x2 + depth, y2 - depth);
            
            context.moveTo(x1, y2);
            context.lineTo(x1 + depth, y2 - depth);
            
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }

        function drawPyramidRotated(x1, y1, x2, y2, context, color, lineWidth, isSelected = false) {
            const width = Math.abs(x2 - x1);
            const centerX = (x1 + x2) / 2;
            const topY = y1 - width / 2;
            
            context.beginPath();
            context.rect(x1, y1, width, width);
            
            context.moveTo(x1, y1);
            context.lineTo(centerX, topY);
            context.lineTo(x1 + width, y1);
            
            context.moveTo(x1 + width, y1);
            context.lineTo(centerX, topY);
            context.lineTo(x1 + width, y1 + width);
            
            context.moveTo(x1 + width, y1 + width);
            context.lineTo(centerX, topY);
            context.lineTo(x1, y1 + width);
            
            context.moveTo(x1, y1 + width);
            context.lineTo(centerX, topY);
            context.lineTo(x1, y1);
            
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            context.stroke();
        }
        
        function drawMarker(context, x, y) {
            context.beginPath();
            context.arc(x, y, 5, 0, Math.PI * 2);
            context.fill();
        }
        
        // Функция для рисования маркера вращения
        function drawRotationMarker(ctx, centerX, centerY, x1, y1, x2, y2, rotation) {
            // Вычисляем радиус для маркера (на 30px дальше от центра)
            const minX = Math.min(x1, x2);
            const maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2);
            const maxY = Math.max(y1, y2);
            const width = maxX - minX;
            const height = maxY - minY;
            const radius = Math.max(width, height) / 2 + 30;
            
            // Вычисляем позицию маркера вращения
            const markerX = centerX + radius * Math.cos(rotation);
            const markerY = centerY + radius * Math.sin(rotation);
            
            // Рисуем линию от центра к маркеру
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(markerX, markerY);
            ctx.strokeStyle = '#4CAF50';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Рисуем маркер вращения (круг со стрелкой)
            ctx.beginPath();
            ctx.arc(markerX, markerY, 8, 0, Math.PI * 2);
            ctx.fillStyle = '#4CAF50';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Рисуем значок вращения внутри круга
            ctx.beginPath();
            ctx.arc(markerX, markerY, 4, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            // Рисуем стрелки
            for (let i = 0; i < 4; i++) {
                const angle = rotation + i * Math.PI / 2;
                const arrowLength = 6;
                const arrowX = markerX + arrowLength * Math.cos(angle);
                const arrowY = markerY + arrowLength * Math.sin(angle);
                
                ctx.beginPath();
                ctx.moveTo(markerX, markerY);
                ctx.lineTo(arrowX, arrowY);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }
        
        // Функция предпросмотра фигуры
        function previewShape(startX, startY, currentX, currentY) {
            if (!currentShape) return;
            
            previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
            previewCanvas.style.display = 'block';
            
            const shapeFunctions = {
                'line': drawLine,
                'circle': drawCircle,
                'square': drawSquare,
                'rectangle': drawRectangle,
                'triangle': drawTriangle,
                'equilateral': drawEquilateralTriangle,
                'right': drawRightTriangle,
                'isosceles': drawIsoscelesTriangle,
                'obtuse': drawObtuseTriangle,
                'diamond': drawDiamond,
                'arrow': drawArrow,
                'cube': drawCube,
                'parallelepiped': drawParallelepiped,
                'pyramid': drawPyramid,
                    'trapezoid': drawTrapezoid,
    'ellipse': drawEllipse,
    'hexagon': drawHexagon
            };
            
            if (shapeFunctions[currentShape]) {
                shapeFunctions[currentShape](
                    startX, startY, currentX, currentY,
                    previewCtx, currentColor, currentBrushSize, false
                );
            }
        }
        
        // Функция рисования фигуры на основном холсте с поддержкой вращения
        function drawShapeOnCanvas(shapeData, isSelected = false) {
            const { shape, x1, y1, x2, y2, color, brushSize, rotation = 0 } = shapeData;
            
            ctx.globalCompositeOperation = 'source-over';
            
            // Вычисляем центр фигуры
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            
            // Сохраняем текущее состояние canvas
            ctx.save();
            
            // Перемещаем начало координат в центр фигуры
            ctx.translate(centerX, centerY);
            
            // Вращаем canvas на угол фигуры
            ctx.rotate(rotation);
            
            // Перемещаем начало координат обратно
            ctx.translate(-centerX, -centerY);
            
            const shapeFunctions = {
                'line': drawLineRotated,
                'circle': drawCircleRotated,
                'square': drawSquareRotated,
                'rectangle': drawRectangleRotated,
                'triangle': drawTriangleRotated,
                'equilateral': drawEquilateralTriangleRotated,
                'right': drawRightTriangleRotated,
                'isosceles': drawIsoscelesTriangleRotated,
                'obtuse': drawObtuseTriangleRotated,
                'diamond': drawDiamondRotated,
                'arrow': drawArrowRotated,
                'cube': drawCubeRotated,
                'parallelepiped': drawParallelepipedRotated,
                'pyramid': drawPyramidRotated,
    'trapezoid': drawTrapezoidRotated,
    'ellipse': drawEllipseRotated,
    'hexagon': drawHexagonRotated                
            };
            
            if (shapeFunctions[shape]) {
                shapeFunctions[shape](
                    x1, y1, x2, y2,
                    ctx, color || currentColor, brushSize || currentBrushSize, isSelected
                );
            }
            
            // Восстанавливаем состояние canvas
            ctx.restore();
            
            // Рисуем маркер вращения если фигура выбрана
            if (isSelected && selectedShape && selectedShape.id === shapeData.id) {
                drawRotationMarker(ctx, centerX, centerY, x1, y1, x2, y2, rotation);
            }
        }
        
        // Функция для перерисовки всех элементов
function redrawAll() {
    // Очищаем canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    
    // Перерисовываем все рисунки
    drawings.forEach(drawData => {
        drawOnCanvas(drawData);
    });
    
    if (drawingBuffer && drawingBuffer.localBuffer) {
        drawingBuffer.localBuffer.forEach(drawData => {
            drawOnCanvas(drawData);
        });
    }
    
    // Перерисовываем все фигуры
    shapes.forEach(shapeData => {
        const isSelected = (selectedShape && selectedShape.id === shapeData.id);
        drawShapeOnCanvas(shapeData, isSelected);
    });
    
    // Рисуем все изображения
    images.forEach(imgObj => {
        if (imgObj.img.complete) {
            ctx.drawImage(imgObj.img, imgObj.x, imgObj.y, imgObj.width, imgObj.height);
            
            // Рисуем рамку вокруг выбранного изображения
            if (selectedImage && selectedImage.id === imgObj.id && currentMode === 'image') {
                ctx.strokeStyle = '#2196F3';
                ctx.lineWidth = 2;
                ctx.strokeRect(imgObj.x - 2, imgObj.y - 2, imgObj.width + 4, imgObj.height + 4);
            }
        }
    });
    
    // Рисуем все графики
    graphs.forEach(graphObj => {
        if (graphObj.img.complete) {
            ctx.drawImage(graphObj.img, graphObj.x, graphObj.y, graphObj.width, graphObj.height);
            
            // Рисуем рамку вокруг выбранного графика
            if (selectedGraph && selectedGraph.id === graphObj.id && currentMode === 'graph') {
                ctx.strokeStyle = '#4CAF50';
                ctx.lineWidth = 2;
                ctx.strokeRect(graphObj.x - 2, graphObj.y - 2, graphObj.width + 4, graphObj.height + 4);
                //ctx.globalAlpha = 0.5
                // Рисуем подпись с функцией
                ctx.fillStyle = '#4CAF50';
                ctx.font = '14px Arial';
                ctx.fillText(graphObj.function, graphObj.x, graphObj.y - 5);
            }
        }
    });
    
    // Обновляем элементы управления вращением
    updateRotationControls();
}
        
        // Функция создания и добавления изображения
        function createAndAddImage(imageSrc, imageData = {}) {
            const img = new Image();
            img.onload = function() {
                const imgObj = {
                    img: img,
                    x: imageData.x || 100,
                    y: imageData.y || 100,
                    width: imageData.width || img.width * 0.5,
                    height: imageData.height || img.height * 0.5,
                    id: imageData.id || 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                    src: imageSrc
                };
                
                images.push(imgObj);
                redrawAll();
                
                // Отправляем на сервер только если это локальное изображение (не полученное от сервера)
                if (!imageData.fromServer) {
                    compressAndSendImage(img, imgObj);
                }
            };
            
            img.onerror = function() {
                console.error('Ошибка загрузки изображения');
                showNotification('Ошибка загрузки изображения', 'error');
            };
            
            img.src = imageSrc;
        }
        
        // Функция сжатия и отправки изображения
        function compressAndSendImage(img, imgObj) {
            const maxWidth = 800;
            const maxHeight = 600;
            let width = img.width;
            let height = img.height;
            
            // Масштабируем если изображение слишком большое
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio;
                height *= ratio;
            }
            
            // Создаем временный canvas для сжатия
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(img, 0, 0, width, height);
            
            // Конвертируем в data URL с качеством 0.7
            const compressedDataUrl = tempCanvas.toDataURL('image/jpeg', 0.7);
            
            // Отправляем на сервер
            socket.emit('add_image', {
                src: compressedDataUrl,
                x: imgObj.x,
                y: imgObj.y,
                width: imgObj.width,
                height: imgObj.height,
                id: imgObj.id
            });
        }
        
        // Функция рисования на холсте
        function drawOnCanvas(data) {
            const { x, y, lastX, lastY, color, brushSize, type } = data;
            
            ctx.beginPath();
            ctx.lineWidth = brushSize;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            if (type === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = color || currentColor;
            }
            
            ctx.moveTo(lastX, lastY);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.closePath();
        }
        
        // Функция очистки холста
function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    ctx.globalCompositeOperation = 'source-over';
    images = [];
    shapes = [];
    graphs = []; // Добавьте эту строку
    selectedShape = null;
    selectedImage = null;
    selectedGraph = null; // Добавьте эту строку
    
    // Очищаем буфер рисования
    if (drawingBuffer) {
        drawingBuffer.localBuffer = [];
    }
    drawings = [];
}
        
        // Создание элемента формулы
        function createFormulaElement(formulaData) {
            const container = document.createElement('div');
            container.className = 'formula-container';
            container.id = formulaData.id;
            container.style.left = `${formulaData.x}px`;
            container.style.top = `${formulaData.y}px`;
            container.style.borderColor = formulaData.user_color || '#2196F3';
            container.style.color = '#000000';
            
            const content = document.createElement('div');
            content.className = 'latex-output';
            content.style.color = '#000000';
            content.style.fontSize = '1.5em';
            content.style.textAlign = 'center';
            content.style.padding = '10px';
            
            content.textContent = formulaData.latex;
            container.appendChild(content);
            
            // Рендерим LaTeX
            renderLatex(formulaData.latex, content);
            
            // Кнопки действий
            const actions = document.createElement('div');
            actions.className = 'formula-actions';
            
            const editBtn = document.createElement('button');
            editBtn.className = 'formula-btn edit';
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                editFormula(formulaData.id, formulaData.latex);
            };
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'formula-btn';
            deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
            
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteFormula(formulaData.id);
            };
            
            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);
            container.appendChild(actions);
            
            // События перетаскивания
            container.addEventListener('mousedown', startDragElement);
            container.addEventListener('touchstart', startDragElement);
            
            container.addEventListener('click', (e) => {
                e.stopPropagation();
                selectElement(container);
            });
            
            return container;
        }
        
        // Создание элемента текста
        function createTextElement(textData) {
            const container = document.createElement('div');
            container.className = 'text-container';
            container.id = textData.id;
            container.style.left = `${textData.x}px`;
            container.style.top = `${textData.y}px`;
            container.style.borderColor = textData.user_color || '#2196F3';
            container.style.color = textData.color || '#000000';
            container.style.fontSize = textData.fontSize || '16px';
            container.style.fontFamily = textData.fontFamily || 'Arial, sans-serif';
            
            const content = document.createElement('div');
            content.className = 'text-content';
            content.style.color = textData.color || '#000000';
            content.style.fontSize = textData.fontSize || '16px';
            content.style.fontFamily = textData.fontFamily || 'Arial, sans-serif';
            content.style.lineHeight = '1.5';
            content.style.padding = '10px';
            content.style.whiteSpace = 'pre-wrap';
            content.style.wordBreak = 'break-word';
            
            content.innerHTML = textData.text.replace(/\n/g, '<br>');
            container.appendChild(content);
            
            // Кнопки действий
            const actions = document.createElement('div');
            actions.className = 'text-actions';
            
            const editBtn = document.createElement('button');
            editBtn.className = 'text-btn edit';
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.onclick = (e) => {
                e.stopPropagation();
                editText(textData.id, textData.text, textData.fontSize, textData.fontFamily);
            };
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'text-btn';
            deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteText(textData.id);
            };
            
            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);
            container.appendChild(actions);
            
            // События перетаскивания
            container.addEventListener('mousedown', startDragElement);
            container.addEventListener('touchstart', startDragElement);
            
            container.addEventListener('click', (e) => {
                e.stopPropagation();
                selectElement(container);
            });
            
            return container;
        }
        
        // Рендеринг LaTeX
        function renderLatex(latexString, container) {
            try {
                container.innerHTML = `\\(${latexString}\\)`;
                if (window.MathJax && MathJax.typesetPromise) {
                    MathJax.typesetPromise([container]);
                }
            } catch (err) {
                container.innerHTML = `<div>${latexString}</div>`;
            }
        }
        
        // Выбор элемента (формулы или текста)
        function selectElement(element) {
            document.querySelectorAll('.formula-container, .text-container').forEach(el => {
                el.classList.remove('active');
            });
            element.classList.add('active');
            selectedElement = element;
        }
        
        // Начало перетаскивания элемента
        function startDragElement(e) {
            e.preventDefault();
            const element = e.target.closest('.formula-container, .text-container');
            if (!element) return;
            
            selectElement(element);
            isDraggingElement = true;
            
            const rect = element.getBoundingClientRect();
            const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
            
            dragOffsetX = clientX - rect.left;
            dragOffsetY = clientY - rect.top;
            
            document.addEventListener('mousemove', dragElement);
            document.addEventListener('touchmove', dragElement);
            document.addEventListener('mouseup', stopDragElement);
            document.addEventListener('touchend', stopDragElement);
        }
        
        // Перетаскивание элемента
        function dragElement(e) {
            if (!isDraggingElement || !selectedElement) return;
            
            e.preventDefault();
            const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
            const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
            
            const containerRect = canvas.getBoundingClientRect();
            const x = clientX - containerRect.left - dragOffsetX;
            const y = clientY - containerRect.top - dragOffsetY;
            
            const maxX = canvas.width - selectedElement.offsetWidth;
            const maxY = canvas.height - selectedElement.offsetHeight;
            
            selectedElement.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
            selectedElement.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
        }
        
        // Окончание перетаскивания
        function stopDragElement() {
            if (!isDraggingElement || !selectedElement) return;
            
            isDraggingElement = false;
            
            if (selectedElement.classList.contains('formula-container')) {
                const formulaData = {
                    id: selectedElement.id,
                    x: parseInt(selectedElement.style.left),
                    y: parseInt(selectedElement.style.top),
                    latex: formulas.find(f => f.id === selectedElement.id)?.latex || ''
                };
                socket.emit('update_formula', formulaData);
            } else if (selectedElement.classList.contains('text-container')) {
                const textData = {
                    id: selectedElement.id,
                    x: parseInt(selectedElement.style.left),
                    y: parseInt(selectedElement.style.top),
                    text: texts.find(t => t.id === selectedElement.id)?.text || ''
                };
                socket.emit('update_text', textData);
            }
            
            document.removeEventListener('mousemove', dragElement);
            document.removeEventListener('touchmove', dragElement);
            document.removeEventListener('mouseup', stopDragElement);
            document.removeEventListener('touchend', stopDragElement);
        }
        
        function deleteFormula(formulaId) {
            const formulaElement = document.getElementById(formulaId);

            if (!formulaElement) return;

            // Удаляем DOM-элемент
            formulaElement.remove();

            // Удаляем из массива
            formulas = formulas.filter(f => f.id !== formulaId);

            // Сообщаем серверу
            socket.emit('delete_formula', { id: formulaId });

            showNotification('Формула удалена', 'success');
        }
        
        function deleteText(textId) {
            const textElement = document.getElementById(textId);

            if (!textElement) return;

            // Удаляем DOM-элемент
            textElement.remove();

            // Удаляем из массива
            texts = texts.filter(t => t.id !== textId);

            // Сообщаем серверу
            socket.emit('delete_text', { id: textId });

            showNotification('Текст удален', 'success');
        }
        
        // Редактирование формулы
        function editFormula(formulaId, currentLatex) {
            latexInput.value = currentLatex;
            updateFormulaPreview();
            setMode('formula');
            
            addFormulaBtn.innerHTML = '<i class="fas fa-save"></i> Сохранить изменения';
            addFormulaBtn.onclick = function() {
                const newLatex = latexInput.value.trim();
                if (newLatex) {
                    const formulaElement = document.getElementById(formulaId);
                    if (formulaElement) {
                        const content = formulaElement.querySelector('.latex-output');
                        renderLatex(newLatex, content);
                        
                        const formulaData = {
                            id: formulaId,
                            x: parseInt(formulaElement.style.left),
                            y: parseInt(formulaElement.style.top),
                            latex: newLatex
                        };
                        socket.emit('update_formula', formulaData);
                        
                        // Обновляем в массиве
                        const index = formulas.findIndex(f => f.id === formulaId);
                        if (index !== -1) {
                            formulas[index].latex = newLatex;
                        }
                    }
                }
                resetFormulaUI();
            };
        }
        
        // Редактирование текста
        function editText(textId, currentText, currentSize, currentFont) {
            textInput.value = currentText;
            textSizeSelect.value = currentSize || '16px';
            textFontSelect.value = currentFont || 'Arial, sans-serif';
            setMode('text');
            
            addTextBtn.innerHTML = '<i class="fas fa-save"></i> Сохранить изменения';
            addTextBtn.onclick = function() {
                const newText = textInput.value.trim();
                if (newText) {
                    const textElement = document.getElementById(textId);
                    if (textElement) {
                        const content = textElement.querySelector('.text-content');
                        content.innerHTML = newText.replace(/\n/g, '<br>');
                        content.style.fontSize = textSizeSelect.value;
                        content.style.fontFamily = textFontSelect.value;
                        
                        const textData = {
                            id: textId,
                            x: parseInt(textElement.style.left),
                            y: parseInt(textElement.style.top),
                            text: newText,
                            fontSize: textSizeSelect.value,
                            fontFamily: textFontSelect.value,
                            color: content.style.color || '#000000'
                        };
                        socket.emit('update_text', textData);
                        
                        // Обновляем в массиве
                        const index = texts.findIndex(t => t.id === textId);
                        if (index !== -1) {
                            texts[index] = { ...texts[index], ...textData };
                        }
                    }
                }
                resetTextUI();
            };
        }
        
        // Сброс UI формулы
        function resetFormulaUI() {
            latexInput.value = '';
            addFormulaBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить формулу';
            addFormulaBtn.onclick = addFormulaHandler;
            updateFormulaPreview();
        }
        
        // Сброс UI текста
        function resetTextUI() {
            textInput.value = '';
            addTextBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Добавить текст';
            addTextBtn.onclick = addTextHandler;
        }
        
        // Обработчик добавления формулы
        function addFormulaHandler() {
            const latex = latexInput.value.trim();
            if (!latex) {
                showNotification('Введите формулу LaTeX', 'error');
                return;
            }
            
            const formulaData = {
                latex: latex,
                x: canvas.width / 2 - 100,
                y: canvas.height / 2 - 50
            };
            
            socket.emit('add_formula', formulaData);
            resetFormulaUI();
        }
        
        // Обработчик добавления текста
        function addTextHandler() {
            const text = textInput.value.trim();
            if (!text) {
                showNotification('Введите текст', 'error');
                return;
            }
            
            const textData = {
                text: text,
                x: canvas.width / 2 - 100,
                y: canvas.height / 2 - 50,
                fontSize: textSizeSelect.value,
                fontFamily: textFontSelect.value,
                color: currentColor
            };
            
            socket.emit('add_text', textData);
            resetTextUI();
        }
        
        // Функция для поворота фигуры
        function rotateShape(degrees) {
            if (!selectedShape) return;
            
            const radians = degrees * Math.PI / 180;
            selectedShape.rotation = (selectedShape.rotation + radians) % (Math.PI * 2);
            
            redrawAll();
            
            // Отправляем обновление на сервер
            socket.emit('update_shape', {
                id: selectedShape.id,
                x1: selectedShape.x1,
                y1: selectedShape.y1,
                x2: selectedShape.x2,
                y2: selectedShape.y2,
                shape: selectedShape.shape,
                color: selectedShape.color,
                brushSize: selectedShape.brushSize,
                rotation: selectedShape.rotation
            });
        }
        
        // Показываем/скрываем элементы управления вращением
        function updateRotationControls() {
            if (currentMode === 'shape' && selectedShape) {
                rotationControls.style.display = 'block';
            } else {
                rotationControls.style.display = 'none';
            }
        }
        
        // Обработчики кнопок вращения
        rotateLeftBtn.addEventListener('click', () => rotateShape(-5));
        rotateRightBtn.addEventListener('click', () => rotateShape(5));
        resetRotationBtn.addEventListener('click', () => {
            if (selectedShape) {
                selectedShape.rotation = 0;
                redrawAll();
                
                socket.emit('update_shape', {
                    id: selectedShape.id,
                    x1: selectedShape.x1,
                    y1: selectedShape.y1,
                    x2: selectedShape.x2,
                    y2: selectedShape.y2,
                    shape: selectedShape.shape,
                    color: selectedShape.color,
                    brushSize: selectedShape.brushSize,
                    rotation: 0
                });
            }
        });
        
        // Обработчики событий мыши
        canvas.addEventListener('mousedown', (e) => {
            const coords = getCanvasCoordinates(e);
    // Для режима "График"
    if (currentMode === 'graph') {
        const graph = hitGraph(coords.x, coords.y);
        if (graph) {
            selectedGraph = graph;
            isDraggingGraph = true;
            graphDragOffsetX = coords.x - graph.x;
            graphDragOffsetY = coords.y - graph.y;
            redrawAll(); // Перерисовываем с выделением
            return;
        } else {
            selectedGraph = null;
            redrawAll();
        }
    }            
            // Для режима "Фигуры" - проверяем попадание на существующую фигуру
            if (currentMode === 'shape') {
                const hitResult = hitShape(coords.x, coords.y);
                if (hitResult) {
                    if (hitResult.type === 'rotate') {
                        // Начало вращения
                        selectedShape = hitResult.shape;
                        isRotatingShape = true;
                        
                        // Вычисляем начальный угол мыши относительно центра фигуры
                        const centerX = (selectedShape.x1 + selectedShape.x2) / 2;
                        const centerY = (selectedShape.y1 + selectedShape.y2) / 2;
                        rotateStartMouseAngle = Math.atan2(coords.y - centerY, coords.x - centerX);
                        rotateStartAngle = selectedShape.rotation || 0;
                        
                        redrawAll();
                        return;
                    } else if (hitResult.type === 'drag') {
                        selectedShape = hitResult.shape;
                        isDraggingShape = true;
                        shapeDragOffsetX = coords.x;
                        shapeDragOffsetY = coords.y;
                        redrawAll(); // Перерисовываем с выделением
                        return;
                    }
                } else if (currentShape) {
                    // Если фигура не выбрана, но есть активная фигура для рисования
                    isDrawingShape = true;
                    shapeStartX = coords.x;
                    shapeStartY = coords.y;
                    return;
                } else {
                    selectedShape = null;
                    redrawAll();
                }
            }
            
            // Для режима "Картинка"
            if (currentMode === 'image') {
                const img = hitImage(coords.x, coords.y);
                if (img) {
                    selectedImage = img;
                    isDraggingImage = true;
                    imageDragOffsetX = coords.x - img.x;
                    imageDragOffsetY = coords.y - img.y;
                    redrawAll();
                    return;
                } else {
                    selectedImage = null;
                    redrawAll();
                }
            }
            
            if (isDraggingElement) return;
            
            isDrawing = true;
            lastX = coords.x;
            lastY = coords.y;
        });
        
        canvas.addEventListener('mousemove', (e) => {
            const coords = getCanvasCoordinates(e);
    // Для режима "График" - перетаскивание графика
    if (currentMode === 'graph' && isDraggingGraph && selectedGraph) {
        e.preventDefault();
        
        const newX = coords.x - graphDragOffsetX;
        const newY = coords.y - graphDragOffsetY;
        
        // Ограничиваем движение в пределах canvas
        selectedGraph.x = Math.max(0, Math.min(newX, canvas.width - selectedGraph.width));
        selectedGraph.y = Math.max(0, Math.min(newY, canvas.height - selectedGraph.height));
        
        redrawAll();
        
        // Отправляем обновление позиции на сервер
        socket.emit('update_graph', {
            id: selectedGraph.id,
            x: selectedGraph.x,
            y: selectedGraph.y,
            width: selectedGraph.width,
            height: selectedGraph.height
        });
        return;
    }            
            // Для режима "Фигуры" - вращение выбранной фигуры
            if (currentMode === 'shape' && isRotatingShape && selectedShape) {
                e.preventDefault();
                
                const centerX = (selectedShape.x1 + selectedShape.x2) / 2;
                const centerY = (selectedShape.y1 + selectedShape.y2) / 2;
                
                // Вычисляем текущий угол мыши
                const currentMouseAngle = Math.atan2(coords.y - centerY, coords.x - centerX);
                
                // Вычисляем изменение угла
                const deltaAngle = currentMouseAngle - rotateStartMouseAngle;
                
                // Обновляем угол вращения фигуры
                selectedShape.rotation = (rotateStartAngle + deltaAngle) % (Math.PI * 2);
                
                redrawAll();
                
                // Отправляем обновление на сервер
                socket.emit('update_shape', {
                    id: selectedShape.id,
                    x1: selectedShape.x1,
                    y1: selectedShape.y1,
                    x2: selectedShape.x2,
                    y2: selectedShape.y2,
                    shape: selectedShape.shape,
                    color: selectedShape.color,
                    brushSize: selectedShape.brushSize,
                    rotation: selectedShape.rotation
                });
                return;
            }
            
            // Для режима "Фигуры" - перетаскивание выбранной фигуры
            if (currentMode === 'shape' && isDraggingShape && selectedShape) {
                e.preventDefault();
                
                const deltaX = coords.x - shapeDragOffsetX;
                const deltaY = coords.y - shapeDragOffsetY;
                
                // Обновляем координаты фигуры
                selectedShape.x1 += deltaX;
                selectedShape.y1 += deltaY;
                selectedShape.x2 += deltaX;
                selectedShape.y2 += deltaY;
                
                shapeDragOffsetX = coords.x;
                shapeDragOffsetY = coords.y;
                
                redrawAll();
                
                // Отправляем обновление на сервер
                socket.emit('update_shape', {
                    id: selectedShape.id,
                    x1: selectedShape.x1,
                    y1: selectedShape.y1,
                    x2: selectedShape.x2,
                    y2: selectedShape.y2,
                    shape: selectedShape.shape,
                    color: selectedShape.color,
                    brushSize: selectedShape.brushSize,
                    rotation: selectedShape.rotation
                });
                return;
            }
            
            // Для режима "Фигуры" - предпросмотр новой фигуры
            if (currentMode === 'shape' && isDrawingShape && currentShape) {
                previewShape(shapeStartX, shapeStartY, coords.x, coords.y);
                return;
            }
            
            // Для режима "Картинка"
            if (currentMode === 'image' && isDraggingImage && selectedImage) {
                e.preventDefault();
                
                const newX = coords.x - imageDragOffsetX;
                const newY = coords.y - imageDragOffsetY;
                
                // Ограничиваем движение в пределах canvas
                selectedImage.x = Math.max(0, Math.min(newX, canvas.width - selectedImage.width));
                selectedImage.y = Math.max(0, Math.min(newY, canvas.height - selectedImage.height));
                
                redrawAll();
                
                // Отправляем обновление позиции на сервер
                socket.emit('update_image', {
                    id: selectedImage.id,
                    x: selectedImage.x,
                    y: selectedImage.y,
                    width: selectedImage.width,
                    height: selectedImage.height
                });
                return;
            }
            
            if (isDraggingElement || !isDrawing) return;
            
            const x = coords.x;
            const y = coords.y;
            const type = e.button === 2 || e.which === 3 ? 'eraser' : 'draw';
            
            // Используем буфер ТОЛЬКО для режима рисования
            if (currentMode === 'draw' && drawingBuffer) {
                const drawingData = {
                    x, y, lastX, lastY,
                    color: type === 'eraser' ? '#ffffff' : currentColor,
                    brushSize: currentBrushSize,
                    type
                };
                
                // Добавляем в буфер
                drawingBuffer.addDrawing(drawingData);
            } else if (currentMode === 'draw') {
                // Старый способ для режима рисования
                drawOnCanvas({
                    x, y, lastX, lastY, 
                    color: type === 'eraser' ? '#ffffff' : currentColor,
                    brushSize: currentBrushSize,
                    type
                });
                
                // Сохраняем в локальную историю
                drawings.push({
                    x, y, lastX, lastY,
                    color: currentColor,
                    brushSize: currentBrushSize,
                    type
                });
                
                socket.emit('drawing', {
                    x, y, lastX, lastY,
                    color: currentColor,
                    brushSize: currentBrushSize,
                    type
                });
            }
            
            lastX = x;
            lastY = y;
        });
        
        canvas.addEventListener('mouseup', (e) => {
            const coords = getCanvasCoordinates(e);
    // Для режима "График"
    if (currentMode === 'graph' && isDraggingGraph) {
        isDraggingGraph = false;
        return;
    }            
            // Для режима "Фигуры" - завершение вращения
            if (currentMode === 'shape' && isRotatingShape) {
                isRotatingShape = false;
                return;
            }
            
            // Для режима "Фигуры" - завершение перетаскивания
            if (currentMode === 'shape' && isDraggingShape) {
                isDraggingShape = false;
                return;
            }
            
            // Для режима "Фигуры" - создание новой фигуры
            if (currentMode === 'shape' && isDrawingShape) {
                isDrawingShape = false;
                previewCanvas.style.display = 'none';
                previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                
                const shapeId = 'shape_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                const shapeData = {
                    id: shapeId,
                    shape: currentShape,
                    x1: shapeStartX,
                    y1: shapeStartY,
                    x2: coords.x,
                    y2: coords.y,
                    color: currentColor,
                    brushSize: currentBrushSize,
                    rotation: 0 // Начальный угол вращения
                };
                
                shapes.push(shapeData);
                redrawAll();
                
                socket.emit('shape_drawn', shapeData);
                return;
            }
            
            // Для режима "Картинка"
            if (currentMode === 'image' && isDraggingImage) {
                isDraggingImage = false;
                return;
            }
            
            isDrawing = false;
        });
        
        canvas.addEventListener('mouseout', () => {
            isDrawing = false;
            if (isDrawingShape) {
                isDrawingShape = false;
                previewCanvas.style.display = 'none';
                previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
            }
            if (isDraggingShape) {
                isDraggingShape = false;
            }
            if (isDraggingImage) {
                isDraggingImage = false;
            }
            if (isRotatingShape) {
                isRotatingShape = false;
            }
        });
        
        // Обработчик колесика мыши для масштабирования изображений и фигур
        canvas.addEventListener('wheel', (e) => {
    if (currentMode === 'graph' && selectedGraph) {
        e.preventDefault();
        
        const coords = getCanvasCoordinates(e);
        const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
        
        // Вычисляем новую ширину и высоту
        const newWidth = selectedGraph.width * scaleFactor;
        const newHeight = selectedGraph.height * scaleFactor;
        
        // Минимальный и максимальный размер
        if (newWidth < 100 || newHeight < 100 || newWidth > 2000 || newHeight > 2000) return;
        
        // Вычисляем смещение для сохранения позиции относительно курсора
        const cursorX = coords.x;
        const cursorY = coords.y;
        const offsetX = cursorX - selectedGraph.x;
        const offsetY = cursorY - selectedGraph.y;
        
        // Обновляем размер и позицию
        selectedGraph.width = newWidth;
        selectedGraph.height = newHeight;
        selectedGraph.x = cursorX - offsetX * scaleFactor;
        selectedGraph.y = cursorY - offsetY * scaleFactor;
        
        redrawAll();
        
        // Отправляем обновление на сервер
        socket.emit('update_graph', {
            id: selectedGraph.id,
            x: selectedGraph.x,
            y: selectedGraph.y,
            width: selectedGraph.width,
            height: selectedGraph.height
        });
    }


            if (currentMode === 'image' && selectedImage) {
                e.preventDefault();
                
                const coords = getCanvasCoordinates(e);
                const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
                
                // Вычисляем новую ширину и высоту
                const newWidth = selectedImage.width * scaleFactor;
                const newHeight = selectedImage.height * scaleFactor;
                
                // Минимальный и максимальный размер
                if (newWidth < 20 || newHeight < 20 || newWidth > 2000 || newHeight > 2000) return;
                
                // Вычисляем смещение для сохранения позиции относительно курсора
                const cursorX = coords.x;
                const cursorY = coords.y;
                const offsetX = cursorX - selectedImage.x;
                const offsetY = cursorY - selectedImage.y;
                
                // Обновляем размер и позицию
                selectedImage.width = newWidth;
                selectedImage.height = newHeight;
                selectedImage.x = cursorX - offsetX * scaleFactor;
                selectedImage.y = cursorY - offsetY * scaleFactor;
                
                redrawAll();
                
                // Отправляем обновление на сервер
                socket.emit('update_image', {
                    id: selectedImage.id,
                    x: selectedImage.x,
                    y: selectedImage.y,
                    width: selectedImage.width,
                    height: selectedImage.height
                });
            } else if (currentMode === 'shape' && selectedShape) {
                e.preventDefault();
                
                const scaleFactor = e.deltaY < 0 ? 1.05 : 0.95;
                
                // Вычисляем центр фигуры
                const centerX = (selectedShape.x1 + selectedShape.x2) / 2;
                const centerY = (selectedShape.y1 + selectedShape.y2) / 2;
                
                // Масштабируем координаты относительно центра
                selectedShape.x1 = centerX + (selectedShape.x1 - centerX) * scaleFactor;
                selectedShape.y1 = centerY + (selectedShape.y1 - centerY) * scaleFactor;
                selectedShape.x2 = centerX + (selectedShape.x2 - centerX) * scaleFactor;
                selectedShape.y2 = centerY + (selectedShape.y2 - centerY) * scaleFactor;
                
                redrawAll();
                
                // Отправляем обновление на сервер
                socket.emit('update_shape', {
                    id: selectedShape.id,
                    x1: selectedShape.x1,
                    y1: selectedShape.y1,
                    x2: selectedShape.x2,
                    y2: selectedShape.y2,
                    shape: selectedShape.shape,
                    color: selectedShape.color,
                    brushSize: selectedShape.brushSize,
                    rotation: selectedShape.rotation
                });
            }
        }, { passive: false });

        // Обработчики событий тачскрина для canvas
    
        // Обновленный обработчик touchstart
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 1) {
                // Существующий код для одиночного касания
                const coords = getCanvasCoordinates(e.touches[0]);
        // Для режима "График"
        if (currentMode === 'graph') {
            const graph = hitGraph(coords.x, coords.y);
            if (graph) {
                selectedGraph = graph;
                isDraggingGraph = true;
                graphDragOffsetX = coords.x - graph.x;
                graphDragOffsetY = coords.y - graph.y;
                redrawAll();
                return;
            } else {
                selectedGraph = null;
                redrawAll();
            }
        }                
                // Для режима "Фигуры" - проверяем попадание на существующую фигуру
                if (currentMode === 'shape') {
                    const hitResult = hitShape(coords.x, coords.y);
                    if (hitResult) {
                        if (hitResult.type === 'rotate') {
                            // Начало вращения
                            selectedShape = hitResult.shape;
                            isRotatingShape = true;
                            
                            // Вычисляем начальный угол касания относительно центра фигуры
                            const centerX = (selectedShape.x1 + selectedShape.x2) / 2;
                            const centerY = (selectedShape.y1 + selectedShape.y2) / 2;
                            rotateStartMouseAngle = Math.atan2(coords.y - centerY, coords.x - centerX);
                            rotateStartAngle = selectedShape.rotation || 0;
                            
                            redrawAll();
                            return;
                        } else if (hitResult.type === 'drag') {
                            selectedShape = hitResult.shape;
                            isDraggingShape = true;
                            shapeDragOffsetX = coords.x;
                            shapeDragOffsetY = coords.y;
                            redrawAll(); // Перерисовываем с выделением
                            return;
                        }
                    } else if (currentShape) {
                        // Если фигура не выбрана, но есть активная фигура для рисования
                        isDrawingShape = true;
                        shapeStartX = coords.x;
                        shapeStartY = coords.y;
                        return;
                    } else {
                        selectedShape = null;
                        redrawAll();
                    }
                }
                
                // Для режима "Картинка"
                if (currentMode === 'image') {
                    const img = hitImage(coords.x, coords.y);
                    if (img) {
                        selectedImage = img;
                        isDraggingImage = true;
                        imageDragOffsetX = coords.x - img.x;
                        imageDragOffsetY = coords.y - img.y;
                        redrawAll();
                        return;
                    } else {
                        selectedImage = null;
                        redrawAll();
                    }
                }
                
                if (isDraggingElement) return;
                
                isDrawing = true;
                lastX = coords.x;
                lastY = coords.y;
            } else if (e.touches.length === 2) {
                // Начало жеста масштабирования двумя пальцами
                isPinching = true;
                isDrawing = false;
                isDrawingShape = false;
                isDraggingShape = false;
                isDraggingImage = false;
                isRotatingShape = false;
                
                // Вычисляем начальное расстояние между пальцами
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                initialPinchDistance = getDistance(touch1, touch2);
                
                // Сохраняем начальные размеры для масштабирования
                if (currentMode === 'image' && selectedImage) {
                    initialWidthOnPinch = selectedImage.width;
                    initialHeightOnPinch = selectedImage.height;
                } else if (currentMode === 'shape' && selectedShape) {
                    initialWidthOnPinch = Math.abs(selectedShape.x2 - selectedShape.x1);
                    initialHeightOnPinch = Math.abs(selectedShape.y2 - selectedShape.y1);
                    initialShapeCenterOnPinch = {
                        x: (selectedShape.x1 + selectedShape.x2) / 2,
                        y: (selectedShape.y1 + selectedShape.y2) / 2
                    };
                }
            }
        });

        // Обновленный обработчик touchmove
        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            
            if (e.touches.length === 1 && !isPinching) {
                // Существующий код для одиночного касания
                const coords = getCanvasCoordinates(e.touches[0]);
        // Для режима "График"
        if (currentMode === 'graph' && isDraggingGraph && selectedGraph) {
            const newX = coords.x - graphDragOffsetX;
            const newY = coords.y - graphDragOffsetY;
            
            selectedGraph.x = Math.max(0, Math.min(newX, canvas.width - selectedGraph.width));
            selectedGraph.y = Math.max(0, Math.min(newY, canvas.height - selectedGraph.height));
            
            redrawAll();
            
            socket.emit('update_graph', {
                id: selectedGraph.id,
                x: selectedGraph.x,
                y: selectedGraph.y,
                width: selectedGraph.width,
                height: selectedGraph.height
            });
            return;
        }                
                // Для режима "Фигуры" - вращение выбранной фигуры
                if (currentMode === 'shape' && isRotatingShape && selectedShape) {
                    const centerX = (selectedShape.x1 + selectedShape.x2) / 2;
                    const centerY = (selectedShape.y1 + selectedShape.y2) / 2;
                    
                    // Вычисляем текущий угол касания
                    const currentMouseAngle = Math.atan2(coords.y - centerY, coords.x - centerX);
                    
                    // Вычисляем изменение угла
                    const deltaAngle = currentMouseAngle - rotateStartMouseAngle;
                    
                    // Обновляем угол вращения фигуры
                    selectedShape.rotation = (rotateStartAngle + deltaAngle) % (Math.PI * 2);
                    
                    redrawAll();
                    
                    // Отправляем обновление на сервер
                    socket.emit('update_shape', {
                        id: selectedShape.id,
                        x1: selectedShape.x1,
                        y1: selectedShape.y1,
                        x2: selectedShape.x2,
                        y2: selectedShape.y2,
                        shape: selectedShape.shape,
                        color: selectedShape.color,
                        brushSize: selectedShape.brushSize,
                        rotation: selectedShape.rotation
                    });
                    return;
                }
                
                // Для режима "Фигуры" - перетаскивание выбранной фигуры
                if (currentMode === 'shape' && isDraggingShape && selectedShape) {
                    const deltaX = coords.x - shapeDragOffsetX;
                    const deltaY = coords.y - shapeDragOffsetY;
                    
                    // Обновляем координаты фигуры
                    selectedShape.x1 += deltaX;
                    selectedShape.y1 += deltaY;
                    selectedShape.x2 += deltaX;
                    selectedShape.y2 += deltaY;
                    
                    shapeDragOffsetX = coords.x;
                    shapeDragOffsetY = coords.y;
                    
                    redrawAll();
                    
                    // Отправляем обновление на сервер
                    socket.emit('update_shape', {
                        id: selectedShape.id,
                        x1: selectedShape.x1,
                        y1: selectedShape.y1,
                        x2: selectedShape.x2,
                        y2: selectedShape.y2,
                        shape: selectedShape.shape,
                        color: selectedShape.color,
                        brushSize: selectedShape.brushSize,
                        rotation: selectedShape.rotation
                    });
                    return;
                }
                
                // Для режима "Фигуры" - предпросмотр новой фигуры
                if (currentMode === 'shape' && isDrawingShape && currentShape) {
                    previewShape(shapeStartX, shapeStartY, coords.x, coords.y);
                    return;
                }
                
                // Для режима "Картинка"
                if (currentMode === 'image' && isDraggingImage && selectedImage) {
                    const newX = coords.x - imageDragOffsetX;
                    const newY = coords.y - imageDragOffsetY;
                    
                    // Ограничиваем движение в пределах canvas
                    selectedImage.x = Math.max(0, Math.min(newX, canvas.width - selectedImage.width));
                    selectedImage.y = Math.max(0, Math.min(newY, canvas.height - selectedImage.height));
                    
                    redrawAll();
                    
                    // Отправляем обновление позиции на сервер
                    socket.emit('update_image', {
                        id: selectedImage.id,
                        x: selectedImage.x,
                        y: selectedImage.y,
                        width: selectedImage.width,
                        height: selectedImage.height
                    });
                    return;
                }
                
                if (isDraggingElement || !isDrawing) return;
                
                const x = coords.x;
                const y = coords.y;
                const type = 'draw'; // Для тачскрина всегда рисуем, ластик отдельным режимом
                
                // Используем буфер ТОЛЬКО для режима рисования
                if (currentMode === 'draw' && drawingBuffer) {
                    const drawingData = {
                        x, y, lastX, lastY,
                        color: type === 'eraser' ? '#ffffff' : currentColor,
                        brushSize: currentBrushSize,
                        type
                    };
                    
                    // Добавляем в буфер
                    drawingBuffer.addDrawing(drawingData);
                } else if (currentMode === 'draw') {
                    // Старый способ для режима рисования
                    drawOnCanvas({
                        x, y, lastX, lastY, 
                        color: type === 'eraser' ? '#ffffff' : currentColor,
                        brushSize: currentBrushSize,
                        type
                    });
                    
                    // Сохраняем в локальную историю
                    drawings.push({
                        x, y, lastX, lastY,
                        color: currentColor,
                        brushSize: currentBrushSize,
                        type
                    });
                    
                    socket.emit('drawing', {
                        x, y, lastX, lastY,
                        color: currentColor,
                        brushSize: currentBrushSize,
                        type
                    });
                }
                
                lastX = x;
                lastY = y;
            } else if (e.touches.length === 2 && isPinching) {
                // Жест масштабирования двумя пальцами
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                const currentDistance = getDistance(touch1, touch2);
                
                // Вычисляем коэффициент масштабирования
                const scaleFactor = currentDistance / initialPinchDistance;
                
                // Применяем масштабирование к выбранному элементу
                if (currentMode === 'image' && selectedImage) {
                    const newWidth = initialWidthOnPinch * scaleFactor;
                    const newHeight = initialHeightOnPinch * scaleFactor;
                    
                    // Минимальный и максимальный размер
                    if (newWidth < 20 || newHeight < 20 || newWidth > 2000 || newHeight > 2000) return;
                    
                    // Вычисляем центр масштабирования (середина между пальцами)
                    const centerX = (touch1.clientX + touch2.clientX) / 2;
                    const centerY = (touch1.clientY + touch2.clientY) / 2;
                    const canvasCoords = getCanvasCoordinates({ clientX: centerX, clientY: centerY });
                    
                    // Обновляем размер
                    selectedImage.width = newWidth;
                    selectedImage.height = newHeight;
                    
                    // Корректируем позицию для сохранения центра масштабирования
                    const offsetX = canvasCoords.x - selectedImage.x;
                    const offsetY = canvasCoords.y - selectedImage.y;
                    selectedImage.x = canvasCoords.x - offsetX * scaleFactor;
                    selectedImage.y = canvasCoords.y - offsetY * scaleFactor;
                    
                    redrawAll();
                    
                    // Отправляем обновление на сервер
                    socket.emit('update_image', {
                        id: selectedImage.id,
                        x: selectedImage.x,
                        y: selectedImage.y,
                        width: selectedImage.width,
                        height: selectedImage.height
                    });
                } else if (currentMode === 'shape' && selectedShape && initialShapeCenterOnPinch) {
                    // Масштабируем фигуру
                    const newWidth = initialWidthOnPinch * scaleFactor;
                    const newHeight = initialHeightOnPinch * scaleFactor;
                    
                    // Вычисляем новые координаты относительно центра
                    const centerX = initialShapeCenterOnPinch.x;
                    const centerY = initialShapeCenterOnPinch.y;
                    
                    selectedShape.x1 = centerX - newWidth / 2;
                    selectedShape.y1 = centerY - newHeight / 2;
                    selectedShape.x2 = centerX + newWidth / 2;
                    selectedShape.y2 = centerY + newHeight / 2;
                    
                    redrawAll();
                    
                    // Отправляем обновление на сервер
                    socket.emit('update_shape', {
                        id: selectedShape.id,
                        x1: selectedShape.x1,
                        y1: selectedShape.y1,
                        x2: selectedShape.x2,
                        y2: selectedShape.y2,
                        shape: selectedShape.shape,
                        color: selectedShape.color,
                        brushSize: selectedShape.brushSize,
                        rotation: selectedShape.rotation
                    });
                }
            }
        });

        // Обновленный обработчик touchend
        canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            
            // Завершаем жест масштабирования, если было два пальца
            if (isPinching) {
                isPinching = false;
                initialPinchDistance = 0;
                initialWidthOnPinch = 0;
                initialHeightOnPinch = 0;
                initialShapeCenterOnPinch = null;
                
                // Если после завершения масштабирования остался один палец, не начинаем рисование
                if (e.touches.length === 0) {
                    return;
                }
            }
    // Для режима "График"
    if (currentMode === 'graph' && isDraggingGraph) {
        isDraggingGraph = false;
        return;
    }            
            // Для режима "Фигуры" - завершение вращения
            if (currentMode === 'shape' && isRotatingShape) {
                isRotatingShape = false;
                return;
            }
            
            // Для режима "Фигуры" - завершение перетаскивания
            if (currentMode === 'shape' && isDraggingShape) {
                isDraggingShape = false;
                return;
            }
            
            // Для режима "Фигуры" - создание новой фигуры
            if (currentMode === 'shape' && isDrawingShape) {
                isDrawingShape = false;
                previewCanvas.style.display = 'none';
                previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                
                // Используем последние координаты из touchmove или берем из последнего события
                if (e.changedTouches.length > 0) {
                    const coords = getCanvasCoordinates(e.changedTouches[0]);
                    const shapeId = 'shape_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                    const shapeData = {
                        id: shapeId,
                        shape: currentShape,
                        x1: shapeStartX,
                        y1: shapeStartY,
                        x2: coords.x,
                        y2: coords.y,
                        color: currentColor,
                        brushSize: currentBrushSize,
                        rotation: 0
                    };
                    
                    shapes.push(shapeData);
                    redrawAll();
                    
                    socket.emit('shape_drawn', shapeData);
                }
                return;
            }
            
            // Для режима "Картинка"
            if (currentMode === 'image' && isDraggingImage) {
                isDraggingImage = false;
                return;
            }
            
            isDrawing = false;
        });

        canvas.addEventListener('touchcancel', () => {
            isDrawing = false;
            isPinching = false;
            if (isDrawingShape) {
                isDrawingShape = false;
                previewCanvas.style.display = 'none';
                previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
            }
            if (isDraggingShape) {
                isDraggingShape = false;
            }
            if (isDraggingImage) {
                isDraggingImage = false;
            }
            if (isRotatingShape) {
                isRotatingShape = false;
            }
        });        



        //end touchscreen
        
        // Отключаем контекстное меню на правый клик
        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
        
        // Выбор цвета
        colorOptions.forEach(option => {
            option.addEventListener('click', () => {
                colorOptions.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
                currentColor = option.dataset.color;
            });
        });
        
        // Выбор размера кисти
        brushSizes.forEach(size => {
            size.addEventListener('click', () => {
                brushSizes.forEach(s => s.classList.remove('active'));
                size.classList.add('active');
                currentBrushSize = parseInt(size.dataset.size);
            });
        });
        
        // Обновление предпросмотра формулы при вводе
        latexInput.addEventListener('input', updateFormulaPreview);
        
        // Обработчик загрузки изображения
        imageUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Проверяем размер файла (макс 5MB)
            if (file.size > 5 * 1024 * 1024) {
                showNotification('Размер файла не должен превышать 5MB', 'error');
                imageUpload.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                uploadedImageData = reader.result;
                showNotification("Изображение загружено. Нажмите 'Добавить изображение'", "success");
            };
            reader.onerror = () => {
                showNotification('Ошибка чтения файла', 'error');
            };
            reader.readAsDataURL(file);
        });
        
        // Обработчик добавления изображения
        addImageBtn.addEventListener('click', () => {
            if (!uploadedImageData) {
                showNotification("Сначала загрузите изображение", "error");
                return;
            }

            createAndAddImage(uploadedImageData, {
                x: canvas.width / 2 - 100,
                y: canvas.height / 2 - 100,
                fromServer: false
            });
            
            uploadedImageData = null;
            imageUpload.value = "";
            showNotification("Изображение добавлено на доску", "success");
        });
        
        // Обработчики кнопок формул и текста
        addFormulaBtn.onclick = addFormulaHandler;
        
        clearFormulaBtn.addEventListener('click', () => {
            latexInput.value = '';
            updateFormulaPreview();
        });
        
        addTextBtn.onclick = addTextHandler;
        
        clearTextBtn.addEventListener('click', () => {
            textInput.value = '';
        });
        
        // Обработчики управления
        clearBtn.addEventListener('click', () => {
            if (confirm('Очистить доску для всех пользователей?')) {
                clearCanvas();
                formulaOverlay.innerHTML = '';
                textOverlay.innerHTML = '';
                formulas = [];
                texts = [];
                drawings = [];
                socket.emit('clear_canvas');
                showNotification('Доска очищена', 'info');
            }
        });
        
        // Кнопка "Отменить"
        undoBtn.addEventListener('click', () => {
            if (drawings.length > 0) {
                drawings.pop();
                socket.emit('undo_last', { type: 'drawing' });
                redrawAll();
            } else if (shapes.length > 0) {
                shapes.pop();
                socket.emit('undo_last', { type: 'shape' });
                redrawAll();
            } else if (images.length > 0 && currentMode === 'image' && selectedImage) {
                const index = images.findIndex(img => img.id === selectedImage.id);
                if (index !== -1) {
                    socket.emit('remove_image', { id: selectedImage.id });
                    images.splice(index, 1);
                    selectedImage = null;
                    redrawAll();
                }
            } else if (shapes.length > 0 && currentMode === 'shape' && selectedShape) {
                const index = shapes.findIndex(shape => shape.id === selectedShape.id);
                if (index !== -1) {
                    socket.emit('remove_shape', { id: selectedShape.id });
                    shapes.splice(index, 1);
                    selectedShape = null;
                    redrawAll();
                }
            } else if (formulas.length > 0) {
                const lastFormula = formulas[formulas.length - 1];
                deleteFormula(lastFormula.id);
            } else if (texts.length > 0) {
                const lastText = texts[texts.length - 1];
                deleteText(lastText.id);
            } else {
                showNotification('Нет действий для отмены', 'info');
            }
        });
        
        // Кнопка сохранения
saveBtn.addEventListener('click', async () => {
    try {
        showNotification('Сохранение изображения...', 'info');

        const board = document.querySelector('#canvas-container');
        
        if (!board) {
            console.error('canvas-container не найден!');
            return;
        }

        const resultCanvas = await html2canvas(board, {
            backgroundColor: '#ffffff',
            scale: 2,
            useCORS: true
        });

        const link = document.createElement('a');
        link.download = `рисунок_доска_${boardId}_${new Date().toISOString().slice(0, 10)}.png`;
        link.href = resultCanvas.toDataURL('image/png');
        link.click();

        showNotification('Изображение сохранено', 'success');

    } catch (error) {
        console.error('Ошибка сохранения:', error);
        showNotification('Ошибка при сохранении изображения', 'error');
    }
});
        
        // Копирование ссылки и ID
        copyLinkBtn.addEventListener('click', copyBoardLink);
        boardIdDisplay.addEventListener('click', copyBoardId);
        newBoardBtn.addEventListener('click', () => {
            window.location.href = '/';
        });

        // ====== НАЧАЛО: Обработчики событий кэширования ======
// Обработка истории графиков
socket.on('graph_history', (history) => {
    console.log('Получена история графиков:', history.length);
    // Загружаем каждый график
    history.forEach(async (graphData) => {
        await loadGraphFromServer(graphData);
    });
});

// Загрузка графика с сервера
async function loadGraphFromServer(graphData) {
    try {
        // Если есть изображение, используем его
        if (graphData.imageUrl) {
            const img = new Image();
            img.onload = function() {
                const graphObj = {
                    img: img,
                    x: graphData.x,
                    y: graphData.y,
                    width: graphData.width,
                    height: graphData.height,
                    id: graphData.id,
                    type: 'graph',
                    function: graphData.function,
                    xMin: graphData.xMin,
                    xMax: graphData.xMax,
                    yMin: graphData.yMin,
                    yMax: graphData.yMax,
                    color: graphData.color,
                    lineWidth: graphData.lineWidth,
                    fromServer: true
                };
                
                graphs.push(graphObj);
                redrawAll();
            };
            img.src = graphData.imageUrl;
        } else {
            // Иначе перестраиваем график
            await addGraphToCanvas({
                ...graphData,
                fromServer: true
            });
        }
    } catch (err) {
        console.error('Ошибка загрузки графика:', err);
    }
}

socket.on('add_graph', (data) => {
    console.log('Получен новый график:', data.id);
    loadGraphFromServer(data);
});

socket.on('update_graph', (data) => {
    console.log('Обновлен график:', data.id);
    updateGraphPosition(data.id, data.x, data.y, data.width, data.height);
});

socket.on('remove_graph', (data) => {
    console.log('Удален график:', data.id);
    const index = graphs.findIndex(graph => graph.id === data.id);
    if (index !== -1) {
        if (selectedGraph && selectedGraph.id === data.id) {
            selectedGraph = null;
        }
        graphs.splice(index, 1);
        redrawAll();
    }
});
        // Обработка пакетного рисования от других пользователей
        socket.on('batch_drawing', (data) => {
            console.log('Получен пакет рисунков:', data.drawings.length);
            
            // Отрисовываем все рисунки из пакета
            data.drawings.forEach(drawing => {
                // Не отрисовываем собственные рисунки (они уже отрисованы локально)
                if (drawing.user_sid !== socket.id) {
                    drawOnCanvas(drawing);
                    // Сохраняем в историю для перерисовки
                    if (!drawings.some(d => d.id === drawing.id)) {
                        drawings.push(drawing);
                    }
                    
                    // Обновляем время получения
                    if (drawingBuffer && drawing.server_timestamp) {
                        drawingBuffer.lastServerTime = Math.max(
                            drawingBuffer.lastServerTime, 
                            drawing.server_timestamp
                        );
                    }
                }
            });
        });

        // Ответ на пинг
        socket.on('pong_drawing', (data) => {
            if (drawingBuffer) {
                drawingBuffer.latency = data.latency || 0;
                drawingBuffer.adjustBatchSize();
            }
        });

        // Получение пропущенных рисунков
        socket.on('missing_drawings', (data) => {
            if (drawingBuffer) {
                drawingBuffer.processMissingDrawings(data.drawings);
            }
        });

        // Синхронизация времени
        socket.on('sync_info', (data) => {
            if (drawingBuffer) {
                drawingBuffer.lastServerTime = data.latest_timestamp || Date.now() / 1000;
            }
        });

        // ====== КОНЕЦ: Обработчики событий кэширования ======        
        
        // События WebSocket
        socket.on('connect', () => {
            console.log('Подключено к серверу, доска ID:', boardId);
            connectionStatus.className = 'status connected';
            connectionStatus.innerHTML = '<i class="fas fa-wifi"></i> Подключено к серверу';
            showNotification('Подключено к доске', 'success');
        });
        
        socket.on('disconnect', () => {
            console.log('Отключено от сервера');
            connectionStatus.className = 'status disconnected';
            connectionStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Отключено от сервера';
            showNotification('Отключено от сервера', 'error');
        });
        
        socket.on('error', (data) => {
            console.error('Ошибка сервера:', data.message);
            showNotification(`Ошибка: ${data.message}`, 'error');
            
            if (data.message.includes('Доска не найдена')) {
                setTimeout(() => {
                    window.location.href = '/';
                }, 2000);
            }
        });
        
        // Получение истории
        socket.on('drawing_history', (history) => {
            console.log('Получена история рисунков:', history.length);
            drawings = history.slice(-100); // Берем только последние 100 для быстрой загрузки
            redrawAll();
            
            // Запрашиваем остальные если нужно
            if (history.length > 100 && drawingBuffer) {
                const lastTimestamp = history[history.length - 101]?.timestamp || 0;
                drawingBuffer.lastServerTime = lastTimestamp;
                drawingBuffer.requestMissingData();
            }
        });       
        // Очистка
        // Обработчик очистки доски
        socket.on('clear_canvas', () => {
            clearCanvas();
            formulaOverlay.innerHTML = '';
            textOverlay.innerHTML = '';
            formulas = [];
            texts = [];
            drawings = [];
            images = [];
            shapes = [];
            selectedShape = null;
            selectedImage = null;
            
            // Очищаем буфер рисования
            if (drawingBuffer) {
                drawingBuffer.localBuffer = [];
            }
            
            showNotification('Доска очищена', 'info');
        });
        
        socket.on('undo_last', (data) => {
            showNotification('Действие отменено', 'info');
            redrawAll();
        });
        
        // Обновление списка пользователей
        socket.on('users_update', (data) => {
            usersList.innerHTML = '';
            data.users.forEach((user, index) => {
                const userItem = document.createElement('div');
                userItem.className = 'user-item';
                userItem.innerHTML = `
                    <div class="user-color" style="background: ${user.color};"></div>
                    <span>${user.username}</span>
                `;
                usersList.appendChild(userItem);
            });
            
            usersCount.textContent = data.count;
            liveUsersCount.textContent = data.count;
        });
        
        // Обработка фигур
        socket.on('shape_history', (history) => {
            console.log('Получена история фигур:', history.length);
            shapes = history;
            redrawAll();
        });
        
        socket.on('shape_drawn', (data) => {
            console.log('Получена новая фигура:', data.id);
            if (!data.rotation) data.rotation = 0;
            shapes.push(data);
            redrawAll();
        });
        
        socket.on('update_shape', (data) => {
            console.log('Обновлена фигура:', data.id);
            const shape = shapes.find(s => s.id === data.id);
            if (shape) {
                shape.x1 = data.x1;
                shape.y1 = data.y1;
                shape.x2 = data.x2;
                shape.y2 = data.y2;
                shape.rotation = data.rotation || 0;
                redrawAll();
            }
        });
        
        socket.on('remove_shape', (data) => {
            console.log('Удалена фигура:', data.id);
            const index = shapes.findIndex(s => s.id === data.id);
            if (index !== -1) {
                if (selectedShape && selectedShape.id === data.id) {
                    selectedShape = null;
                }
                shapes.splice(index, 1);
                redrawAll();
            }
        });
        
        // Обработка изображений
        socket.on('image_history', (history) => {
            console.log('Получена история изображений:', history.length);
            history.forEach(imageData => {
                createAndAddImage(imageData.src, {
                    ...imageData,
                    fromServer: true
                });
            });
        });
        
        socket.on('add_image', (data) => {
            console.log('Получено новое изображение от другого пользователя:', data.id);
            createAndAddImage(data.src, {
                ...data,
                fromServer: true
            });
        });
        
        socket.on('update_image', (data) => {
            console.log('Обновлено изображение:', data.id);
            const img = images.find(img => img.id === data.id);
            if (img) {
                img.x = data.x;
                img.y = data.y;
                img.width = data.width;
                img.height = data.height;
                redrawAll();
            }
        });
        
        socket.on('remove_image', (data) => {
            console.log('Удалено изображение:', data.id);
            const index = images.findIndex(img => img.id === data.id);
            if (index !== -1) {
                if (selectedImage && selectedImage.id === data.id) {
                    selectedImage = null;
                }
                images.splice(index, 1);
                redrawAll();
            }
        });
        
        // Обработка формул
        socket.on('formula_history', (history) => {
            console.log('Получена история формул:', history.length);
            formulas = history;
            history.forEach(formulaData => {
                const formulaElement = createFormulaElement(formulaData);
                formulaOverlay.appendChild(formulaElement);
            });
        });
        
        socket.on('add_formula', (data) => {
            formulas.push(data);
            const formulaElement = createFormulaElement(data);
            formulaOverlay.appendChild(formulaElement);
        });
        
        socket.on('update_formula', (data) => {
            const index = formulas.findIndex(f => f.id === data.id);
            if (index !== -1) {
                formulas[index] = data;
                const formulaElement = document.getElementById(data.id);
                if (formulaElement) {
                    formulaElement.style.left = `${data.x}px`;
                    formulaElement.style.top = `${data.y}px`;
                    const content = formulaElement.querySelector('.latex-output');
                    renderLatex(data.latex, content);
                }
            }
        });
        
        socket.on('delete_formula', (data) => {
            formulas = formulas.filter(f => f.id !== data.id);
            const formulaElement = document.getElementById(data.id);
            if (formulaElement) {
                formulaElement.remove();
            }
        });
        
        // Обработка текста
        socket.on('text_history', (history) => {
            console.log('Получена история текстов:', history.length);
            texts = history;
            history.forEach(textData => {
                const textElement = createTextElement(textData);
                textOverlay.appendChild(textElement);
            });
        });
        
        socket.on('add_text', (data) => {
            texts.push(data);
            const textElement = createTextElement(data);
            textOverlay.appendChild(textElement);
        });
        
        socket.on('update_text', (data) => {
            const index = texts.findIndex(t => t.id === data.id);
            if (index !== -1) {
                texts[index] = data;
                const textElement = document.getElementById(data.id);
                if (textElement) {
                    textElement.style.left = `${data.x}px`;
                    textElement.style.top = `${data.y}px`;
                    const content = textElement.querySelector('.text-content');
                    content.innerHTML = data.text.replace(/\n/g, '<br>');
                    if (data.fontSize) {
                        content.style.fontSize = data.fontSize;
                        textElement.style.fontSize = data.fontSize;
                    }
                    if (data.fontFamily) {
                        content.style.fontFamily = data.fontFamily;
                        textElement.style.fontFamily = data.fontFamily;
                    }
                }
            }
        });
        
        socket.on('delete_text', (data) => {
            texts = texts.filter(t => t.id !== data.id);
            const textElement = document.getElementById(data.id);
            if (textElement) {
                textElement.remove();
            }
        });
        
        // Рисование
        socket.on('drawing', (data) => {
            drawings.push(data);
            drawOnCanvas(data);
        });
 
        // Обработка нажатия клавиш
        document.addEventListener('keydown', (e) => {
            
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                undoBtn.click();
            }
            
            if (e.key === '[' && selectedShape) {
                e.preventDefault();
                rotateShape(-15); // Поворот на 15° влево
            } else if (e.key === ']' && selectedShape) {
                e.preventDefault();
                rotateShape(15); // Поворот на 15° вправо
            } else if (e.key === '\\' && selectedShape) {
                e.preventDefault();
                selectedShape.rotation = 0;
                redrawAll();
                
                socket.emit('update_shape', {
                    id: selectedShape.id,
                    x1: selectedShape.x1,
                    y1: selectedShape.y1,
                    x2: selectedShape.x2,
                    y2: selectedShape.y2,
                    shape: selectedShape.shape,
                    color: selectedShape.color,
                    brushSize: selectedShape.brushSize,
                    rotation: 0
                });
            }
            
            if (e.key === 'Delete') {
        if (currentMode === 'graph' && selectedGraph) {
            if (confirm('Удалить выбранный график?')) {
                const index = graphs.findIndex(graph => graph.id === selectedGraph.id);
                if (index !== -1) {
                    socket.emit('remove_graph', { id: selectedGraph.id });
                    graphs.splice(index, 1);
                    selectedGraph = null;
                    redrawAll();
                    showNotification('График удален', 'success');
                }
            }
            e.preventDefault();
        }                
                if (currentMode === 'image' && selectedImage) {
                    if (confirm('Удалить выбранное изображение?')) {
                        const index = images.findIndex(img => img.id === selectedImage.id);
                        if (index !== -1) {
                            socket.emit('remove_image', { id: selectedImage.id });
                            images.splice(index, 1);
                            selectedImage = null;
                            redrawAll();
                            showNotification('Изображение удалено', 'success');
                        }
                    }
                    e.preventDefault();
                } else if (currentMode === 'shape' && selectedShape) {
                    if (confirm('Удалить выбранную фигуру?')) {
                        const index = shapes.findIndex(shape => shape.id === selectedShape.id);
                        if (index !== -1) {
                            socket.emit('remove_shape', { id: selectedShape.id });
                            shapes.splice(index, 1);
                            selectedShape = null;
                            redrawAll();
                            showNotification('Фигура удалена', 'success');
                        }
                    }
                    e.preventDefault();
                } else if (selectedElement) {
                    if (confirm('Удалить выбранный элемент?')) {
                        if (selectedElement.classList.contains('formula-container')) {
                            deleteFormula(selectedElement.id);
                        } else if (selectedElement.classList.contains('text-container')) {
                            deleteText(selectedElement.id);
                        }
                        selectedElement = null;
                    }
                }
            }
            
            if (e.key === 'Escape') {
                selectedImage = null;
                selectedShape = null;
                if (selectedElement) {
                    selectedElement.classList.remove('active');
                    selectedElement = null;
                }
                redrawAll();
            }
            
            if (e.key === 'Enter' && (document.activeElement === latexInput || document.activeElement === textInput)) {
                e.preventDefault();
                if (document.activeElement === latexInput) {
                    addFormulaHandler();
                } else {
                    addTextHandler();
                }
            }
        });
        
        // Клик по холсту для снятия выделения
        canvas.addEventListener('click', () => {
            if (selectedElement && !isDraggingElement) {
                selectedElement.classList.remove('active');
                selectedElement = null;
            }
        });
        
        // Инициализация MathJax
        document.addEventListener('DOMContentLoaded', function() {
            if (window.MathJax) {
                MathJax.startup.promise.then(() => {
                    console.log('MathJax загружен и готов к работе');
                    updateFormulaPreview();
                });
            }
        });